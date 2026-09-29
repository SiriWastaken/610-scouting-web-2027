import { recordAudit } from "@/lib/auth/audit";
import { clearCookie, json, jsonError } from "@/lib/auth/requests";
import { authRuntime, authenticateCookieHeader, isTrustedOrigin } from "@/lib/auth/requests";
import { readCookie, revokeSession, sessionCookieName } from "@/lib/auth/sessions";
import { authMetrics } from "@/lib/ops/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends this browser's session. POST only, same-origin only, so a link on another site cannot sign anyone out. */
export async function POST(request: Request) {
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured on this server");
  if (!isTrustedOrigin(request.headers.get("origin"), auth.config)) return jsonError(403, "bad_origin", "Cross-site requests are not allowed");
  const name = sessionCookieName(auth.config);
  const cookieHeader = request.headers.get("cookie");
  const current = await authenticateCookieHeader(cookieHeader, auth).catch(() => null);
  const ended = await revokeSession(auth.store, readCookie(cookieHeader, name)).catch(() => false);
  if (current?.status === "signed-in") {
    authMetrics.signOut();
    await recordAudit(auth.store, { action: "auth.signout", result: "success", actor: { id: current.viewer.userId, email: current.viewer.user.email, role: current.viewer.principal.role } });
  }
  return json({ ok: true, ended }, { cookies: [clearCookie(name, auth.config.secureCookies)] });
}
