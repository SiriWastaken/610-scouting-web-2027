import { parsePatch, publicUser, updateOwnProfile } from "@/lib/auth/accounts";
import { recordAudit } from "@/lib/auth/audit";
import { guard, json, jsonError, readJson } from "@/lib/auth/http";
import { authRuntime, clientViewer } from "@/lib/auth/runtime";
import { invalidateUserSessions, listUserSessions } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in user's own account and their sessions (devices). Other users' data is never reachable here. */
export async function GET(request: Request) {
  const checked = await guard(request, { action: "account.read" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const { viewer } = checked;
  const sessions = (await listUserSessions(auth.store, viewer.userId)).map(({ id, session }) => ({
    current: id === viewer.session.id, provider: session.provider, device: session.device ?? null,
    createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt,
  }));
  return json({ ...clientViewer(auth.config, viewer), sessions });
}

/** Edits your own display and scout name. Role, status, and anything else are refused, and the attempt is audited. */
export async function PATCH(request: Request) {
  const checked = await guard(request, { action: "account.update" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const { viewer } = checked;
  const parsed = parsePatch(await readJson(request), "profile");
  if (!parsed.ok) {
    if (parsed.forbiddenFields?.length) {
      await recordAudit(auth.store, { action: "account.update", result: "denied", actor: { id: viewer.userId, email: viewer.user.email, role: viewer.principal.role }, target: { type: "user", id: viewer.userId }, reason: `Tried to set ${parsed.forbiddenFields.slice(0, 5).join(", ")} on own account` });
    }
    return jsonError(400, "invalid", parsed.error);
  }
  const user = await updateOwnProfile(auth.store, viewer.userId, { displayName: parsed.patch.displayName, scoutName: parsed.patch.scoutName });
  invalidateUserSessions(viewer.userId);
  await recordAudit(auth.store, { action: "account.update", result: "success", actor: { id: viewer.userId, email: viewer.user.email, role: viewer.principal.role }, target: { type: "user", id: viewer.userId, label: user.displayName }, meta: { fields: Object.keys(parsed.patch).join(",") } });
  return json({ user: publicUser(auth.config, viewer.userId, user) });
}
