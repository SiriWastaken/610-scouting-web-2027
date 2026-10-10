// GET and PATCH /api/admin/users/<id> — read one account, or change its role, status, names or note. The role
// rules are enforced here, not only in the UI.
import { AccountError, adminUpdateUser, getUser, parsePatch, principalFor, publicUser } from "@/lib/auth/accounts";
import { listAudit, recordAudit } from "@/lib/auth/audit";
import { guard, json, jsonError, readJson } from "@/lib/auth/requests";
import { assignableRoles, can, canManageUser } from "@/lib/auth/roles";
import { authRuntime } from "@/lib/auth/requests";
import { invalidateUserSessions, listUserSessions, revokeUserSessions } from "@/lib/auth/sessions";
import { scoutingStore } from "@/services/scouting-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const checked = await guard(request, { permission: "users:read", action: "users.read" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const { id } = await params;
  const found = await getUser(auth.store, id);
  if (!found) return jsonError(404, "not_found", "No such account");
  const actor = checked.viewer.principal;
  const manageable = canManageUser(actor, principalFor(auth.config, id, found.body));
  const sessions = (await listUserSessions(auth.store, id)).map(({ session }) => ({ provider: session.provider, device: session.device ?? null, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt }));
  const scouting = found.body.scoutName ? (await scoutingStore.scoutActivity()).get(found.body.scoutName.trim().toLowerCase()) ?? null : null;
  // Audit history only for those allowed to read the audit log.
  const history = can(actor, "audit:read") ? (await listAudit(auth.store, { search: id, limit: 20 })).entries : null;
  return json({ user: { ...publicUser(auth.config, id, found.body, "admin"), rev: found.rev }, sessions, scouting, history, manageable, assignableRoles: manageable ? assignableRoles(actor) : [] });
}

const STATUS: Record<AccountError["code"], number> = { forbidden: 403, invalid: 400, not_found: 404, conflict: 409 };

/** Changes another account. Every rule lives in adminUpdateUser; this route only translates and audits. */
export async function PATCH(request: Request, { params }: Context) {
  const checked = await guard(request, { permission: "users:manage", action: "users.update" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const { id } = await params;
  const { viewer } = checked;
  const actor = { id: viewer.userId, email: viewer.user.email, role: viewer.principal.role };
  const parsed = parsePatch(await readJson(request), "admin");
  if (!parsed.ok) return jsonError(400, "invalid", parsed.error);
  try {
    const { before, after, rev } = await adminUpdateUser(auth.store, auth.config, viewer.principal, id, parsed.patch);
    invalidateUserSessions(id);
    let revoked = 0;
    if (after.status === "disabled" && before.status !== "disabled") revoked = await revokeUserSessions(auth.store, id);
    const changes: Record<string, string | null> = {};
    for (const field of ["displayName", "scoutName", "adminNote", "role", "status"] as const) {
      if (before[field] !== after[field]) changes[field] = field === "adminNote" ? "(changed)" : `${before[field] ?? "∅"} → ${after[field] ?? "∅"}`;
    }
    const action = changes.role ? "users.role" : changes.status ? "users.status" : "users.update";
    await recordAudit(auth.store, { action, result: "success", actor, target: { type: "user", id, label: `${after.displayName} <${after.email}>` }, meta: { ...changes, sessionsRevoked: revoked } });
    return json({ user: { ...publicUser(auth.config, id, after, "admin"), rev } });
  } catch (error) {
    if (!(error instanceof AccountError)) throw error;
    if (error.code === "forbidden") {
      await recordAudit(auth.store, { action: parsed.patch.role ? "users.role" : "users.update", result: "denied", actor, target: { type: "user", id }, reason: error.message, meta: { requestedRole: parsed.patch.role ?? null, requestedStatus: parsed.patch.status ?? null } });
    }
    return jsonError(STATUS[error.code], error.code, error.message);
  }
}
