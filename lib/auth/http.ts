// Route handler helpers: the authorization guard every protected API route
// runs, JSON errors, and cookies. Plain Web `Request`/`Response` only (no
// next/* imports), so the test bench calls the real handlers directly.
import { recordAudit } from "./audit.ts";
import { authRuntime, authenticateCookieHeader, isTrustedOrigin } from "./runtime.ts";
import { can, type Permission } from "./roles.ts";
import type { Viewer } from "./sessions.ts";

export const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export function json(body: unknown, init: { status?: number; headers?: Record<string, string>; cookies?: string[] } = {}): Response {
  const headers = new Headers({ ...noStore, ...init.headers, "Content-Type": "application/json" });
  for (const cookie of init.cookies ?? []) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export const jsonError = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) => json({ error, message, ...extra }, { status });

export function redirectTo(location: string, cookies: string[] = [], status = 303): Response {
  const headers = new Headers({ ...noStore, Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status, headers });
}

export interface CookieOptions { httpOnly?: boolean; secure?: boolean; sameSite?: "lax" | "strict" | "none"; path?: string; maxAge?: number; expires?: Date }

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
  return parts.join("; ");
}

export const clearCookie = (name: string, secure: boolean) => serializeCookie(name, "", { httpOnly: true, secure, sameSite: "lax", maxAge: 0, expires: new Date(0) });

const AUDITED: ReadonlySet<Permission> = new Set(["users:read", "users:manage", "ops:read", "ops:diagnose", "audit:read"]);

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
