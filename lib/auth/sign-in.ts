// Sign in with Google (OpenID Connect), end to end:
//   - crypto: random tokens, hashing, and the encrypted state cookie (AES-256-GCM)
//   - jwt: verifying Google's ID tokens against its published keys
//   - oidc: starting a sign-in, and checking the callback (state, nonce, PKCE, code exchange)
// The browser only ever carries the provider's one-time code and the encrypted
// state cookie; everything else happens server to server.
import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import type { VerifiedIdentity } from "./accounts.ts";
import type { AuthConfig, ProviderConfig, ProviderId } from "./config.ts";

// ── crypto ────────────────────────────────────────

const base64url = (buffer: Buffer | Uint8Array) => Buffer.from(buffer).toString("base64url");
export const randomToken = (bytes = 32) => base64url(randomBytes(bytes));
export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const keyFor = (secret: string, purpose: string) => createHash("sha256").update(`${purpose}\0${secret}`).digest();

/**
 * Encrypts and authenticates a small JSON value (AES-256-GCM) for a cookie the
 * browser must carry but can neither read nor alter, such as OAuth state and
 * the PKCE verifier. `purpose` binds the value to one use.
 */
export function seal(value: unknown, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return base64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

export function unseal<T>(token: string | undefined, secret: string, purpose: string): T | null {
  if (!token || token.length > 4096) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { return null; }
}

/** PKCE S256 challenge for a verifier. */
export const pkceChallenge = (verifier: string) => base64url(createHash("sha256").update(verifier).digest());

// ── jwt ────────────────────────────────────────

// The small part of JOSE the sign-in flow needs, on node:crypto: verifying a
// provider's ID token against its published keys (RS256, which is what Google uses).

export interface JwtClaims { iss?: unknown; aud?: unknown; sub?: unknown; exp?: unknown; iat?: unknown; nbf?: unknown; nonce?: unknown; [claim: string]: unknown }

export class TokenError extends Error {}

const ALGORITHMS: Record<string, { hash: string; kty: string }> = {
  RS256: { hash: "sha256", kty: "RSA" },
};

interface CachedKeys { keys: Map<string, { key: KeyObject; kty: string }>; fetchedAt: number }
const jwksCache = new Map<string, CachedKeys>();
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_REFRESH_FLOOR_MS = 30 * 1000;

async function loadKeys(jwksUri: string, force: boolean): Promise<CachedKeys> {
  const cached = jwksCache.get(jwksUri);
  if (cached && (!force || Date.now() - cached.fetchedAt < JWKS_REFRESH_FLOOR_MS) && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached;
  const response = await fetch(jwksUri, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new TokenError(`Signing keys unavailable (HTTP ${response.status})`);
  const body = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys = new Map<string, { key: KeyObject; kty: string }>();
  for (const jwk of body.keys ?? []) {
    if (typeof jwk.kid !== "string" || (jwk.use !== undefined && jwk.use !== "sig")) continue;
    try { keys.set(jwk.kid, { key: createPublicKey({ key: jwk, format: "jwk" }), kty: String(jwk.kty) }); } catch { /* skip unusable keys */ }
  }
  const entry = { keys, fetchedAt: Date.now() };
  jwksCache.set(jwksUri, entry);
  return entry;
}

function decodeSegment<T>(segment: string): T {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T; } catch { throw new TokenError("Malformed token"); }
}

export interface VerifyOptions { jwksUri: string; issuers: string[]; audience: string; nonce?: string; clockSkewSeconds?: number; now?: number }

/** Verifies signature, issuer, audience, expiry, and nonce. Throws TokenError on any failure. */
export async function verifyIdToken(token: string, options: VerifyOptions): Promise<JwtClaims> {
  if (typeof token !== "string" || token.length > 16_384) throw new TokenError("Malformed token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("Malformed token");
  const header = decodeSegment<{ alg?: unknown; kid?: unknown }>(parts[0]);
  const algorithm = typeof header.alg === "string" ? ALGORITHMS[header.alg] : undefined;
  // "none" and HMAC algorithms are never accepted: the key must be the provider's published public key.
  if (!algorithm || typeof header.kid !== "string") throw new TokenError("Unsupported token algorithm");
  let entry = (await loadKeys(options.jwksUri, false)).keys.get(header.kid);
  if (!entry) entry = (await loadKeys(options.jwksUri, true)).keys.get(header.kid); // keys rotate
  if (!entry || entry.kty !== algorithm.kty) throw new TokenError("Unknown signing key");
  const valid = verify(algorithm.hash, Buffer.from(`${parts[0]}.${parts[1]}`), { key: entry.key }, Buffer.from(parts[2], "base64url"));
  if (!valid) throw new TokenError("Invalid token signature");

  const claims = decodeSegment<JwtClaims>(parts[1]);
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (typeof claims.iss !== "string" || !options.issuers.includes(claims.iss)) throw new TokenError("Unexpected token issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) throw new TokenError("Token was issued for another application");
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== options.audience) throw new TokenError("Token was issued for another application");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new TokenError("Token has expired");
  if (typeof claims.nbf === "number" && claims.nbf - skew > now) throw new TokenError("Token is not valid yet");
  if (typeof claims.iat === "number" && claims.iat - skew > now) throw new TokenError("Token was issued in the future");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new TokenError("Token has no subject");
  if (options.nonce !== undefined && claims.nonce !== options.nonce) throw new TokenError("Token nonce does not match this sign-in");
  return claims;
}

/** Test/diagnostic hook: forget cached provider keys. */
export function clearJwksCache() { jwksCache.clear(); }

// ── oidc ────────────────────────────────────────

// Sign in with Google (OpenID Connect authorization code flow). The browser only ever carries the provider's one-time code and an
// encrypted state cookie; the code is exchanged server-to-server and the ID
// token's signature, issuer, audience, expiry, and nonce are all verified.

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

const redirectUri = (config: AuthConfig, provider: ProviderId) => `${config.baseUrl}/api/auth/callback/${provider}`;

export interface CookieSpec { name: string; value: string; options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number } }

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
  state.verifier = randomToken(48);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("code_challenge", pkceChallenge(state.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return {
    url: url.toString(),
    cookie: {
      name: stateCookieName(config),
      value: seal(state, config.secret, STATE_PURPOSE),
      options: { httpOnly: true, secure: config.secureCookies, sameSite: "lax", path: "/", maxAge: STATE_MAX_AGE_MS / 1000 },
    },
  };
}

export interface CallbackParams { code?: string | null; state?: string | null; error?: string | null }

async function exchangeCode(config: AuthConfig, settings: ProviderConfig, code: string, verifier?: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(config, settings.id), client_id: settings.clientId });
  body.set("client_secret", settings.clientSecret);
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
      name: typeof claims.name === "string" ? claims.name : undefined,
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
    },
  };
}
