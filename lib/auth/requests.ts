// Who is making this request, and whether they may: the one path every API
// route (guard), page (lib/auth/pages.ts), and WebSocket upgrade
// (lib/realtime-server.ts) goes through. Framework-free (plain Request and
// Response), so scripts/server.mjs, Next.js, and the tests all run the same code.
//   - runtime: configuration plus the account store; reading the session cookie
//   - http: the route guard (CSRF origin, session, status, permission), JSON and cookie helpers
import { publicUser } from "./accounts.ts";
import { recordAudit } from "./audit.ts";
import { readAuthConfig, type AuthConfig } from "./config.ts";
import { can, type Permission } from "./roles.ts";
import { sessionCookieName, validateSession, readCookie, type Viewer } from "./sessions.ts";
import { AuthStore, LocalAuthStore, StoreUnavailableError, type AccountStore } from "./store.ts";

// ── runtime ────────────────────────────────────────

// The entry point the rest of the server uses: configuration plus the account
// store, and "who is making this request?" from a raw Cookie header. Framework
// free, so the WebSocket upgrade handler in scripts/server.mjs and the Next.js
// route handlers make exactly the same decision.

export type AuthRuntime = { ok: true; config: AuthConfig; store: AccountStore } | { ok: false; problems: string[] };

let cached: { key: string; store: AccountStore } | undefined;

/** The auth configuration and account store for this process, or the list of what is misconfigured. */
export function authRuntime(env: Record<string, string | undefined> = process.env): AuthRuntime {
  const result = readAuthConfig(env);
  if (!result.ok) return result;
  const { localStorePath, store } = result.config;
  const key = localStorePath ? `local:${localStorePath}` : JSON.stringify(store);
  if (cached?.key !== key) cached = { key, store: localStorePath ? new LocalAuthStore(localStorePath) : new AuthStore(store) };
  return { ok: true, config: result.config, store: cached.store };
}

/**
 * Who is making a request: a signed-in viewer, nobody (with the reason), or 'unavailable' when the 
 * account store is down.
 */
export type Authentication =
  | { status: "signed-in"; viewer: Viewer }
  | { status: "signed-out"; reason: "missing" | "malformed" | "unknown" | "expired" | "disabled" }
  /** Sign-in is not configured, or the account store is unreachable: nobody can be authenticated right now. */
  | { status: "unavailable"; reason: string };

/**
 * Resolves a raw Cookie header to an Authentication. Used by API routes, pages and the WebSocket 
 * upgrade.
 */
export async function authenticateCookieHeader(cookieHeader: string | string[] | null | undefined, runtime: AuthRuntime = authRuntime()): Promise<Authentication> {
  if (!runtime.ok) return { status: "unavailable", reason: "Sign-in is not configured on this server" };
  const token = readCookie(cookieHeader, sessionCookieName(runtime.config));
  try {
    const check = await validateSession(runtime.store, runtime.config, token);
    return check.ok ? { status: "signed-in", viewer: check.viewer } : { status: "signed-out", reason: check.reason };
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      logStoreProblem(error.message);
      return { status: "unavailable", reason: "The account store is unreachable" };
    }
    throw error;
  }
}

// Every request hits this during an outage; say why in the server log once a minute, not per request.
let lastStoreLog = 0;
function logStoreProblem(message: string) {
  if (Date.now() - lastStoreLog < 60_000) return;
  lastStoreLog = Date.now();
  console.error(`Sessions cannot be checked: ${message}`);
}

/**
 * CSRF defence for state-changing requests: browsers always send Origin on
 * cross-origin POST/PATCH/DELETE, so it must be the dashboard's own origin.
 * (Session cookies are also SameSite=Lax.)
 */
export function isTrustedOrigin(origin: string | null | undefined, config: Pick<AuthConfig, "baseUrl">): boolean {
  if (!origin) return false;
  try { return new URL(origin).origin === config.baseUrl; } catch { return false; }
}

/** The signed-in user and session as the browser may see them: no token, no other sessions. */
export function clientViewer(config: AuthConfig, viewer: Viewer) {
  return {
    user: publicUser(config, viewer.userId, viewer.user),
    session: { provider: viewer.session.provider, createdAt: viewer.session.createdAt, expiresAt: viewer.session.expiresAt, idleExpiresAt: viewer.session.idleExpiresAt, lastSeenAt: viewer.session.lastSeenAt, device: viewer.session.device ?? null },
  };
}
/** The part of a viewer that is safe to send to the browser. */
export type ClientViewer = ReturnType<typeof clientViewer>;

// ── http ────────────────────────────────────────

// Route handler helpers: the authorization guard every protected API route
// runs, JSON errors, and cookies. Plain Web `Request`/`Response` only (no
// next/* imports), so the test bench calls the real handlers directly.

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

/** A JSON response with no-store caching and optional extra cookies. */
export function json(body: unknown, init: { status?: number; headers?: Record<string, string>; cookies?: string[] } = {}): Response {
  const headers = new Headers({ ...noStore, ...init.headers, "Content-Type": "application/json" });
  for (const cookie of init.cookies ?? []) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

/** A JSON error response: status, a short code, and a message safe to show. */
export const jsonError = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) => json({ error, message, ...extra }, { status });

/** A redirect response (303 by default) that can also set cookies. */
export function redirectTo(location: string, cookies: string[] = [], status = 303): Response {
  const headers = new Headers({ ...noStore, Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

/** The cookie attributes this app uses. */
export interface CookieOptions { httpOnly?: boolean; secure?: boolean; sameSite?: "lax" | "strict" | "none"; path?: string; maxAge?: number; expires?: Date }

/** Builds a Set-Cookie header value. */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
  return parts.join("; ");
}

/** A Set-Cookie header value that deletes a cookie. */
export const clearCookie = (name: string, secure: boolean) => serializeCookie(name, "", { httpOnly: true, secure, sameSite: "lax", maxAge: 0, expires: new Date(0) });

const AUDITED: ReadonlySet<Permission> = new Set(["users:read", "users:manage", "ops:read", "ops:diagnose", "audit:read"]);

/** What an API route requires: an optional permission, and the audit action name to record. */
export interface GuardOptions { permission?: Permission; action: string }

/**
 * The authorization guard for API routes. Order: CSRF origin (for writes),
 * session, account status, permission. Nothing the client sends besides the
 * session cookie influences the decision. Denials of privileged operations
 * are written to the audit log.
 */
export async function guard(request: Request, options: GuardOptions): Promise<{ ok: true; viewer: Viewer } | { ok: false; response: Response }> {
  const runtime = authRuntime();
  if (!runtime.ok) return { ok: false, response: jsonError(503, "auth_unavailable", "Sign-in is not configured on this server") };
  if (request.method !== "GET" && request.method !== "HEAD" && !isTrustedOrigin(request.headers.get("origin"), runtime.config)) {
    await recordAudit(runtime.store, { action: `${options.action}.csrf`, result: "denied", reason: "Cross-origin or origin-less write request", meta: { origin: request.headers.get("origin")?.slice(0, 100) ?? null, method: request.method } });
    return { ok: false, response: jsonError(403, "bad_origin", "Cross-site requests are not allowed") };
  }
  const auth = await authenticateCookieHeader(request.headers.get("cookie"), runtime);
  if (auth.status === "unavailable") return { ok: false, response: jsonError(503, "auth_unavailable", auth.reason) };
  if (auth.status === "signed-out") {
    if (options.permission && AUDITED.has(options.permission)) await recordAudit(runtime.store, { action: options.action, result: "denied", reason: `Not signed in (${auth.reason})` });
    return { ok: false, response: jsonError(401, auth.reason === "expired" ? "session_expired" : "signin_required", auth.reason === "expired" ? "Your session has expired. Sign in again." : "Sign in to continue.") };
  }
  const { viewer } = auth;
  if (viewer.principal.status === "disabled" || (options.permission && !can(viewer.principal, options.permission))) {
    if (options.permission && AUDITED.has(options.permission)) {
      await recordAudit(runtime.store, { action: options.action, result: "denied", actor: { id: viewer.userId, email: viewer.user.email, role: viewer.principal.role }, reason: `Requires ${options.permission}; account is ${viewer.principal.role} (${viewer.principal.status})` });
    }
    return { ok: false, response: jsonError(403, "forbidden", viewer.principal.status === "active" ? "Your role does not allow this." : "Your account is not active.") };
  }
  return { ok: true, viewer };
}

/** Reads a JSON body with a size cap. Returns undefined for anything that is not a JSON request. */
export async function readJson(request: Request, maxBytes = 8 * 1024): Promise<unknown> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return undefined;
  const text = await request.text();
  if (text.length > maxBytes) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}
