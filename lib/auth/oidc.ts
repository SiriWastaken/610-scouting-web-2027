// Sign in with Google and Sign in with Apple (OpenID Connect authorization code
// flow). The browser only ever carries the provider's one-time code and an
// encrypted state cookie; the code is exchanged server-to-server and the ID
// token's signature, issuer, audience, expiry, and nonce are all verified.
import type { VerifiedIdentity } from "./accounts.ts";
import type { AuthConfig, ProviderConfig, ProviderId } from "./config.ts";
import { pkceChallenge, randomToken, safeEqual, seal, unseal } from "./crypto.ts";
import { appleClientSecret, TokenError, verifyIdToken } from "./jwt.ts";

export type SignInErrorCode = "provider_unavailable" | "state_mismatch" | "expired" | "denied" | "token_invalid" | "exchange_failed" | "email_unverified" | "no_email" | "disabled" | "store_unavailable";

export class SignInError extends Error {
  readonly code: SignInErrorCode;
  constructor(code: SignInErrorCode, message: string) { super(message); this.code = code; }
}

interface OAuthState { provider: ProviderId; state: string; nonce: string; verifier?: string; returnTo: string; createdAt: number }

const STATE_PURPOSE = "oauth-state";
const STATE_MAX_AGE_MS = 10 * 60_000;
export const stateCookieName = (config: Pick<AuthConfig, "secureCookies">) => (config.secureCookies ? "__Host-610_oauth" : "610_oauth");

/**
 * Where to go after signing in. Only same-site paths, never `//host`,
 * backslash tricks, API routes, or the welcome screen itself.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/";
  try {
    const url = new URL(value, "http://return.invalid");
    if (url.origin !== "http://return.invalid" || url.pathname.startsWith("/api/") || url.pathname === "/welcome") return "/";
    return `${url.pathname}${url.search}`;
  } catch { return "/"; }
}

export const redirectUri = (config: AuthConfig, provider: ProviderId) => `${config.baseUrl}/api/auth/callback/${provider}`;

export interface CookieSpec { name: string; value: string; options: { httpOnly: true; secure: boolean; sameSite: "lax" | "none"; path: "/"; maxAge: number } }

function requireProvider(config: AuthConfig, provider: ProviderId): ProviderConfig {
  const settings = config.providers[provider];
  if (!settings) throw new SignInError("provider_unavailable", `Sign in with ${provider} is not configured`);
  return settings;
}

export function beginSignIn(config: AuthConfig, provider: ProviderId, returnTo: unknown): { url: string; cookie: CookieSpec } {
  const settings = requireProvider(config, provider);
  const state: OAuthState = { provider, state: randomToken(24), nonce: randomToken(24), returnTo: safeReturnTo(returnTo), createdAt: Date.now() };
  const url = new URL(settings.authorizationEndpoint);
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config, provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state.state);
  url.searchParams.set("nonce", state.nonce);
  if (provider === "google") {
    state.verifier = randomToken(48);
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("code_challenge", pkceChallenge(state.verifier));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
  } else {
    // Apple only returns email and name with form_post, a cross-site POST back to us.
    url.searchParams.set("scope", "name email");
    url.searchParams.set("response_mode", "form_post");
  }
  return {
    url: url.toString(),
    cookie: {
      name: stateCookieName(config),
      value: seal(state, config.secret, STATE_PURPOSE),
      // SameSite=None is required for Apple's cross-site POST, and browsers only accept it with Secure.
      options: { httpOnly: true, secure: config.secureCookies, sameSite: provider === "apple" && config.secureCookies ? "none" : "lax", path: "/", maxAge: STATE_MAX_AGE_MS / 1000 },
    },
  };
}

export interface CallbackParams { code?: string | null; state?: string | null; error?: string | null; user?: string | null }

async function exchangeCode(config: AuthConfig, settings: ProviderConfig, code: string, verifier?: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(config, settings.id), client_id: settings.clientId });
  body.set("client_secret", settings.apple ? appleClientSecret(settings.apple, settings.clientId, settings.issuer) : settings.clientSecret ?? "");
  if (verifier) body.set("code_verifier", verifier);
  let response: Response;
  try {
    response = await fetch(settings.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch { throw new SignInError("exchange_failed", `Could not reach ${settings.id} to finish signing in`); }
  const payload = await response.json().catch(() => ({})) as { id_token?: unknown; error?: unknown };
  if (!response.ok || typeof payload.id_token !== "string") {
    // `invalid_grant` means the code was already used or has expired.
    throw new SignInError(payload.error === "invalid_grant" ? "expired" : "exchange_failed", `${settings.id} rejected the sign-in (HTTP ${response.status}${typeof payload.error === "string" ? `, ${payload.error.slice(0, 40)}` : ""})`);
  }
  return payload.id_token;
}

/** Apple sends the user's name once, on first authorization, as unsigned JSON next to the code. */
function appleName(user: string | null | undefined): string | undefined {
  if (!user || user.length > 2000) return undefined;
  try {
    const parsed = JSON.parse(user) as { name?: { firstName?: unknown; lastName?: unknown } };
    const parts = [parsed.name?.firstName, parsed.name?.lastName].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    return parts.length ? parts.join(" ") : undefined;
  } catch { return undefined; }
}

/**
 * Validates the callback against the state cookie, exchanges the code, and
 * verifies the ID token. Returns the identity and where to send the user.
 */
export async function completeSignIn(config: AuthConfig, provider: ProviderId, params: CallbackParams, stateCookie: string | undefined): Promise<{ identity: VerifiedIdentity; returnTo: string }> {
  const settings = requireProvider(config, provider);
  const saved = unseal<OAuthState>(stateCookie, config.secret, STATE_PURPOSE);
  if (params.error) throw new SignInError("denied", params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "Sign-in was cancelled" : "The provider reported an error");
  if (!saved || saved.provider !== provider || typeof params.state !== "string" || !safeEqual(saved.state, params.state)) {
    throw new SignInError("state_mismatch", "This sign-in link is not valid in this browser. Start again.");
  }
  if (Date.now() - saved.createdAt > STATE_MAX_AGE_MS) throw new SignInError("expired", "The sign-in took too long. Start again.");
  if (typeof params.code !== "string" || !params.code || params.code.length > 2048) throw new SignInError("token_invalid", "The provider did not return a sign-in code");

  const idToken = await exchangeCode(config, settings, params.code, saved.verifier);
  let claims;
  try {
    claims = await verifyIdToken(idToken, { jwksUri: settings.jwksUri, issuers: [settings.issuer, ...settings.alternateIssuers], audience: settings.clientId, nonce: saved.nonce });
  } catch (error) {
    throw new SignInError("token_invalid", error instanceof TokenError ? error.message : "Could not verify the sign-in");
  }
  const verified = claims.email_verified === true || claims.email_verified === "true";
  return {
    returnTo: saved.returnTo,
    identity: {
      provider, subject: claims.sub as string,
      email: typeof claims.email === "string" && claims.email.length <= 254 ? claims.email.toLowerCase() : undefined,
      emailVerified: verified,
      name: provider === "apple" ? appleName(params.user) : typeof claims.name === "string" ? claims.name : undefined,
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
    },
  };
}
