import { recordAudit } from "@/lib/auth/audit";
import { guard, json, jsonError } from "@/lib/auth/requests";
import { authRuntime } from "@/lib/auth/requests";
import { revokeUserSessions } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Sign out other devices": ends every session of the signed-in user except this one. */
export async function DELETE(request: Request) {
  const checked = await guard(request, { action: "account.sessions.revoke" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const { viewer } = checked;
  const revoked = await revokeUserSessions(auth.store, viewer.userId, { except: viewer.session.id });
  await recordAudit(auth.store, { action: "account.sessions.revoke", result: "success", actor: { id: viewer.userId, email: viewer.user.email, role: viewer.principal.role }, target: { type: "user", id: viewer.userId }, meta: { revoked } });
  return json({ revoked });
}
