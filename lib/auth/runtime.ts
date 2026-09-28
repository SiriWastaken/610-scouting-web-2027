// The entry point the rest of the server uses: configuration plus the account
// store, and "who is making this request?" from a raw Cookie header. Framework
// free, so the WebSocket upgrade handler in scripts/server.mjs and the Next.js
// route handlers make exactly the same decision.
import { publicUser } from "./accounts.ts";
import { readAuthConfig, type AuthConfig } from "./config.ts";
import { sessionCookieName, validateSession, readCookie, type Viewer } from "./sessions.ts";
import { AuthStore, StoreUnavailableError } from "./store.ts";

export type AuthRuntime = { ok: true; config: AuthConfig; store: AuthStore } | { ok: false; problems: string[] };

let cached: { key: string; store: AuthStore } | undefined;

export function authRuntime(env: Record<string, string | undefined> = process.env): AuthRuntime {
  const result = readAuthConfig(env);
  if (!result.ok) return result;
  const key = JSON.stringify(result.config.store);
  if (cached?.key !== key) cached = { key, store: new AuthStore(result.config.store) };
  return { ok: true, config: result.config, store: cached.store };
}

export type Authentication =
  | { status: "signed-in"; viewer: Viewer }
  | { status: "signed-out"; reason: "missing" | "malformed" | "unknown" | "expired" | "disabled" }
  /** Sign-in is not configured, or the account store is unreachable: nobody can be authenticated right now. */
  | { status: "unavailable"; reason: string };

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
export type ClientViewer = ReturnType<typeof clientViewer>;
