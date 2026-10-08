// DELETE /api/admin/users/<id>/sessions — sign an account out everywhere. Needs `users:manage`.
import { getUser, principalFor } from "@/lib/auth/accounts";
import { recordAudit } from "@/lib/auth/audit";
import { guard, json, jsonError } from "@/lib/auth/requests";
import { canManageUser } from "@/lib/auth/roles";
import { authRuntime } from "@/lib/auth/requests";
import { revokeUserSessions } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signs an account out everywhere (open realtime connections close within a minute). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checked = await guard(request, { permission: "users:manage", action: "users.sessions.revoke" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const { id } = await params;
  const { viewer } = checked;
  const actor = { id: viewer.userId, email: viewer.user.email, role: viewer.principal.role };
  const found = await getUser(auth.store, id);
  if (!found) return jsonError(404, "not_found", "No such account");
  if (!canManageUser(viewer.principal, principalFor(auth.config, id, found.body))) {
    await recordAudit(auth.store, { action: "users.sessions.revoke", result: "denied", actor, target: { type: "user", id }, reason: "Role cannot manage this account" });
    return jsonError(403, "forbidden", "Your role cannot manage this account");
  }
  const revoked = await revokeUserSessions(auth.store, id);
  await recordAudit(auth.store, { action: "users.sessions.revoke", result: "success", actor, target: { type: "user", id, label: `${found.body.displayName} <${found.body.email}>` }, meta: { revoked } });
  return json({ revoked });
}
