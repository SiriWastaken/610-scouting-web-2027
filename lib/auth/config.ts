// Server-side authentication settings, read from the environment on each call
// (like lib/couchbase-config.ts) so tests and restarts pick up changes. Nothing
// here may reach the browser: it holds client secrets and store credentials.
// Every variable is documented in docs/10-authentication.md.

export type ProviderId = "google";
const PROVIDERS: readonly ProviderId[] = ["google"];
/** Whether a value names a sign-in provider this app supports. */
export function isProviderId(value: unknown): value is ProviderId { return value === "google"; }

/** One sign-in provider's OAuth client settings and endpoints. */
export interface ProviderConfig {
  id: ProviderId;
  clientId: string;
  clientSecret: string;
  issuer: string;
  /** Google also uses a bare-host form of its issuer. */
  alternateIssuers: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/** Where accounts, sessions and the audit log are stored (a Sync Gateway collection, or a local file in development). */
export interface AuthStoreConfig {
  url: string;
  /** Sync Gateway database (on Capella App Services: the App Endpoint name). */
  database: string;
  /** Scope and collection holding the account documents; `_default` for a database's default collection. */
  scope: string;
  collection: string;
  username: string;
  password: string;
}

/**
 * How Sync Gateway's REST API addresses the store: `db` for the default
 * collection, `db.scope.collection` for a named one (Sync Gateway 3.x keyspaces).
 */
export function storeKeyspace(store: Pick<AuthStoreConfig, "database" | "scope" | "collection">): string {
  return store.scope === "_default" && store.collection === "_default" ? store.database : `${store.database}.${store.scope}.${store.collection}`;
}

/** Everything the auth code needs, read once from the environment and validated. */
export interface AuthConfig {
  /** Public origin of the dashboard, e.g. `https://scout.example.org`. Redirect URIs and CSRF checks use it, never the Host header. */
  baseUrl: string;
  secureCookies: boolean;
  secret: string;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  /** AUTH_OWNER_EMAILS: always OWNER, active, and unchangeable from the app. */
  ownerEmails: Set<string>;
  sessionMaxAgeMs: number;
  sessionIdleMs: number;
  store: AuthStoreConfig;
  /** AUTH_STORE=local (development only): accounts are kept in this file instead of Sync Gateway. */
  localStorePath?: string;
  /** Set only when provider endpoints are redirected to a local stand-in (tests, local development). */
  endpointOverride?: string;
}

/** Either a valid configuration, or the list of what is wrong with it (names of settings only, never values). */
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
  return { issuer: "https://accounts.google.com", alternateIssuers: ["accounts.google.com"], authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token", jwksUri: "https://www.googleapis.com/oauth2/v3/certs" };
}

/**
 * The account store is reached through the Sync Gateway / App Services REST API, so its URL must be
 * that public endpoint (`https://` or `wss://`, usually port 4984), not a Couchbase connection string.
 * A copied Capella App Endpoint URL ending in `/<database>` is accepted and trimmed to the origin.
 */
function checkStoreUrl(raw: string | undefined, database: string): { url: string; problem?: string } {
  const value = (raw ?? "").trim();
  if (!value) return { url: "" };
  if (/^couchbases?:\/\//i.test(value)) {
    return { url: "", problem: "is a Couchbase connection string (couchbase:// or couchbases://). Use the App Services / Sync Gateway public URL instead, e.g. wss://<id>.apps.cloud.couchbase.com:4984 (Capella: App Services → your App Endpoint → Connect)" };
  }
  let url: URL;
  try { url = new URL(value.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:")); } catch { return { url: "", problem: "is not a valid URL (expected e.g. wss://<host>:4984)" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { url: "", problem: `uses ${url.protocol}//; expected https:// or wss:// (the App Services / Sync Gateway public URL)` };
  if (url.username || url.password) return { url: "", problem: "must not contain a username or password; use AUTH_STORE_USERNAME / AUTH_STORE_PASSWORD" };
  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== `/${database}`) return { url: "", problem: `must be just the server address, without a path (got "${path}"); put the database name in AUTH_STORE_DATABASE` };
  return { url: url.origin };
}

/** Marker words used only by the placeholders in .env.example. */
function isTemplatePlaceholder(value: string): boolean {
  return /your-sync-gateway-host|other-sync-gateway-host|replace-with-|replace-me|your-client-id|your-google-client-secret|your-account-store-password|you@example\.org/i.test(value);
}

type Env = Record<string, string | undefined>;

function readBaseUrl(env: Env, problems: string[]): string {
  try {
    const url = new URL(env.AUTH_URL ?? "");
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.origin;
  } catch {
    problems.push("AUTH_URL must be the dashboard's public origin, e.g. https://scout.example.org");
    return "";
  }
}

function readProviders(env: Env, override: string | undefined, problems: string[]): AuthConfig["providers"] {
  if (!env.AUTH_GOOGLE_CLIENT_ID || !env.AUTH_GOOGLE_CLIENT_SECRET) {
    problems.push("Google sign-in is not configured: set AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET");
    return {};
  }
  return { google: { id: "google", clientId: env.AUTH_GOOGLE_CLIENT_ID, clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET, ...providerEndpoints("google", override) } };
}

/** The account store, or the first thing wrong with it. `local` skips the checks: that store is a file. */
function readStore(env: Env, local: boolean, problems: string[]): AuthStoreConfig {
  // AUTH_STORE_DATABASE is a database name, or a whole keyspace `database.scope.collection`.
  const [database = "", scopeFromKeyspace, collectionFromKeyspace, ...extra] = (env.AUTH_STORE_DATABASE ?? "").trim().split(".");
  const urlSource = env.AUTH_STORE_URL ? "AUTH_STORE_URL" : "COUCHBASE_SYNC_GATEWAY_URL";
  const storeUrl = checkStoreUrl(env.AUTH_STORE_URL || env.COUCHBASE_SYNC_GATEWAY_URL, database);
  const store: AuthStoreConfig = {
    url: storeUrl.url,
    database,
    scope: scopeFromKeyspace ?? (env.AUTH_STORE_SCOPE?.trim() || "_default"),
    collection: collectionFromKeyspace ?? (env.AUTH_STORE_COLLECTION?.trim() || "_default"),
    username: env.AUTH_STORE_USERNAME ?? "",
    password: env.AUTH_STORE_PASSWORD ?? "",
  };
  if (local) return store;
  if (storeUrl.problem) problems.push(`${urlSource} ${storeUrl.problem}`);
  else {
    const problem = storeProblem(store, env, { extra, keyspaceScope: scopeFromKeyspace, keyspaceCollection: collectionFromKeyspace });
    if (problem) problems.push(problem);
  }
  return store;
}

function storeProblem(store: AuthStoreConfig, env: Env, keyspace: { extra: string[]; keyspaceScope?: string; keyspaceCollection?: string }): string | undefined {
  if (!store.url || !store.database || !store.username || !store.password) {
    return "The account store needs AUTH_STORE_DATABASE, AUTH_STORE_USERNAME, AUTH_STORE_PASSWORD (and AUTH_STORE_URL or COUCHBASE_SYNC_GATEWAY_URL)";
  }
  if (keyspace.extra.length || (keyspace.keyspaceScope !== undefined && keyspace.keyspaceCollection === undefined)) {
    return "AUTH_STORE_DATABASE must be a database name, or database.scope.collection (e.g. scoutingapp.app.auth)";
  }
  if ([store.database, store.scope, store.collection].some((part) => !part || /[\s/?#%]/.test(part))) {
    return "AUTH_STORE_DATABASE, AUTH_STORE_SCOPE, and AUTH_STORE_COLLECTION may not be empty or contain spaces, slashes, ?, # or %";
  }
  const database = env.COUCHBASE_DATABASE ?? "";
  const sameAsScouting = store.url === checkStoreUrl(env.COUCHBASE_SYNC_GATEWAY_URL, database).url && store.database === database
    && store.scope === (env.COUCHBASE_SCOPE || "_default") && store.collection === (env.COUCHBASE_COLLECTION || "_default");
  // Scouting tablets sync the scouting collection; accounts and sessions must never be replicated to them.
  return sameAsScouting ? "The account store must be a different collection (or database) from the scouting data: set AUTH_STORE_COLLECTION, e.g. auth" : undefined;
}

/**
 * Values copied unchanged from .env.example would pass every other check, send people to Google, and
 * only fail after they approve. Name them here instead, before anyone tries to sign in.
 */
function placeholderProblems(env: Env, store: AuthStoreConfig, local: boolean): string[] {
  const problems = Object.entries(env)
    .filter(([name, value]) => name.startsWith("AUTH_") && typeof value === "string" && isTemplatePlaceholder(value))
    .map(([name]) => `${name} is still the placeholder from .env.example`);
  if (!local && !env.AUTH_STORE_URL && isTemplatePlaceholder(store.url)) problems.push("COUCHBASE_SYNC_GATEWAY_URL (also used for the account store) is still the placeholder from .env.example");
  return problems;
}

/** Reads and validates the AUTH_* and account-store settings. Never throws: a bad configuration is reported as a list of problems. */
export function readAuthConfig(env: Env = process.env): AuthConfigResult {
  const problems: string[] = [];
  const baseUrl = readBaseUrl(env, problems);
  const secret = env.AUTH_SECRET ?? "";
  if (secret.length < 32) problems.push("AUTH_SECRET must be at least 32 characters (generate with `openssl rand -base64 48`)");
  const override = env.AUTH_OIDC_ENDPOINT_OVERRIDE || undefined;
  const providers = readProviders(env, override, problems);

  // AUTH_STORE=local keeps accounts in a file on this machine, for development before the real store is reachable.
  const local = (env.AUTH_STORE ?? "").trim().toLowerCase() === "local";
  const localStorePath = local ? (env.AUTH_STORE_LOCAL_PATH?.trim() || ".data/auth-store.json") : undefined;
  if (local && env.NODE_ENV === "production") {
    problems.push("AUTH_STORE=local is for development only; production needs the Sync Gateway account store (AUTH_STORE_DATABASE, …)");
  }
  const store = readStore(env, local, problems);
  problems.push(...placeholderProblems(env, store, local));

  if (problems.length) return { ok: false, problems };
  return { ok: true, config: { baseUrl, secret, providers, store, localStorePath, ...sessionSettings(env, baseUrl), endpointOverride: override } };
}

function sessionSettings(env: Env, baseUrl: string) {
  return {
    secureCookies: baseUrl.startsWith("https:"),
    // AUTH_ROOT_EMAILS is the earlier name of the same setting.
    ownerEmails: new Set(list(env.AUTH_OWNER_EMAILS ?? env.AUTH_ROOT_EMAILS)),
    sessionMaxAgeMs: hours(env.AUTH_SESSION_MAX_AGE_HOURS, 24 * 30),
    sessionIdleMs: hours(env.AUTH_SESSION_IDLE_HOURS, 24 * 7),
  };
}

/** Which providers the sign-in screen should offer. Safe to send to the browser. */
export function enabledProviders(result: AuthConfigResult = readAuthConfig()): ProviderId[] {
  return result.ok ? PROVIDERS.filter((id) => result.config.providers[id]) : [];
}
