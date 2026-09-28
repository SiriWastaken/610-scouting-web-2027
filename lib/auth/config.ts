// Server-side authentication settings, read from the environment on each call
// (like lib/couchbase-config.ts) so tests and restarts pick up changes. Nothing
// here may reach the browser: it holds client secrets and store credentials.
// Every variable is documented in docs/authentication.md.

export type ProviderId = "google" | "apple";
export const PROVIDERS: readonly ProviderId[] = ["google", "apple"];
export function isProviderId(value: unknown): value is ProviderId { return value === "google" || value === "apple"; }

export interface ProviderConfig {
  id: ProviderId;
  clientId: string;
  /** Google: the client secret. Apple: generated per request from the key below. */
  clientSecret?: string;
  apple?: { teamId: string; keyId: string; privateKey: string };
  issuer: string;
  /** Some issuers (Google) also use a bare-host form. */
  alternateIssuers: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

export interface AuthStoreConfig { url: string; database: string; username: string; password: string }

export interface AuthConfig {
  /** Public origin of the dashboard, e.g. `https://scout.example.org`. Redirect URIs and CSRF checks use it, never the Host header. */
  baseUrl: string;
  secureCookies: boolean;
  secret: string;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  rootEmails: Set<string>;
  /** Exact emails, or domains written as `@example.org`, that become active members on first sign-in. Everyone else waits for approval. */
  autoApprove: string[];
  sessionMaxAgeMs: number;
  sessionIdleMs: number;
  store: AuthStoreConfig;
  /** Set only when provider endpoints are redirected to a local stand-in (tests, local development). */
  endpointOverride?: string;
}

export type AuthConfigResult = { ok: true; config: AuthConfig } | { ok: false; problems: string[] };

const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
const hours = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 3_600_000;
};

function providerEndpoints(id: ProviderId, override: string | undefined) {
  if (override) {
    const base = `${override.replace(/\/$/, "")}/${id}`;
    return { issuer: base, alternateIssuers: [], authorizationEndpoint: `${base}/authorize`, tokenEndpoint: `${base}/token`, jwksUri: `${base}/jwks` };
  }
  return id === "google"
    ? { issuer: "https://accounts.google.com", alternateIssuers: ["accounts.google.com"], authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token", jwksUri: "https://www.googleapis.com/oauth2/v3/certs" }
    : { issuer: "https://appleid.apple.com", alternateIssuers: [], authorizationEndpoint: "https://appleid.apple.com/auth/authorize", tokenEndpoint: "https://appleid.apple.com/auth/token", jwksUri: "https://appleid.apple.com/auth/keys" };
}

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfigResult {
  const problems: string[] = [];
  let baseUrl = "";
  try {
    const url = new URL(env.AUTH_URL ?? "");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    baseUrl = url.origin;
  } catch { problems.push("AUTH_URL must be the dashboard's public origin, e.g. https://scout.example.org"); }
  const secret = env.AUTH_SECRET ?? "";
  if (secret.length < 32) problems.push("AUTH_SECRET must be at least 32 characters (generate with `openssl rand -base64 48`)");

  const override = env.AUTH_OIDC_ENDPOINT_OVERRIDE || undefined;
  const providers: AuthConfig["providers"] = {};
  if (env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET) {
    providers.google = { id: "google", clientId: env.AUTH_GOOGLE_CLIENT_ID, clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET, ...providerEndpoints("google", override) };
  }
  if (env.AUTH_APPLE_CLIENT_ID && env.AUTH_APPLE_TEAM_ID && env.AUTH_APPLE_KEY_ID && env.AUTH_APPLE_PRIVATE_KEY) {
    providers.apple = {
      id: "apple", clientId: env.AUTH_APPLE_CLIENT_ID,
      // Hosting dashboards often store multi-line keys with literal "\n".
      apple: { teamId: env.AUTH_APPLE_TEAM_ID, keyId: env.AUTH_APPLE_KEY_ID, privateKey: env.AUTH_APPLE_PRIVATE_KEY.replace(/\\n/g, "\n") },
      ...providerEndpoints("apple", override),
    };
  }
  if (!providers.google && !providers.apple) problems.push("No sign-in provider is configured: set AUTH_GOOGLE_CLIENT_ID + AUTH_GOOGLE_CLIENT_SECRET and/or the four AUTH_APPLE_* variables");

  const store = {
    url: (env.AUTH_STORE_URL || env.COUCHBASE_SYNC_GATEWAY_URL || "").replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, ""),
    database: env.AUTH_STORE_DATABASE ?? "",
    username: env.AUTH_STORE_USERNAME ?? "",
    password: env.AUTH_STORE_PASSWORD ?? "",
  };
  if (!store.url || !store.database || !store.username || !store.password) {
    problems.push("The account store needs AUTH_STORE_DATABASE, AUTH_STORE_USERNAME, AUTH_STORE_PASSWORD (and AUTH_STORE_URL or COUCHBASE_SYNC_GATEWAY_URL)");
  } else if (store.database === env.COUCHBASE_DATABASE && store.url === (env.COUCHBASE_SYNC_GATEWAY_URL ?? "").replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "")) {
    // Scouting tablets sync the scouting database; accounts and sessions must never be replicated to them.
    problems.push("AUTH_STORE_DATABASE must be a different Sync Gateway database from COUCHBASE_DATABASE");
  }

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    config: {
      baseUrl, secret, providers, store,
      secureCookies: baseUrl.startsWith("https:"),
      rootEmails: new Set(list(env.AUTH_ROOT_EMAILS)),
      autoApprove: list(env.AUTH_AUTO_APPROVE),
      sessionMaxAgeMs: hours(env.AUTH_SESSION_MAX_AGE_HOURS, 24 * 30),
      sessionIdleMs: hours(env.AUTH_SESSION_IDLE_HOURS, 24 * 7),
      endpointOverride: override,
    },
  };
}

export function isAutoApproved(config: AuthConfig, email: string): boolean {
  const normalized = email.toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@"));
  return config.autoApprove.some((entry) => entry === normalized || (entry.startsWith("@") && entry === domain));
}

/** Which providers the sign-in screen should offer. Safe to send to the browser. */
export function enabledProviders(result: AuthConfigResult = readAuthConfig()): ProviderId[] {
  return result.ok ? PROVIDERS.filter((id) => result.config.providers[id]) : [];
}
