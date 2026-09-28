import { listUsers, principalFor, publicUser } from "@/lib/auth/accounts";
import { guard, json, jsonError } from "@/lib/auth/http";
import { canManageUser, assignableRoles } from "@/lib/auth/roles";
import { authRuntime } from "@/lib/auth/runtime";
import { SESSION_PREFIX, type SessionDoc } from "@/lib/auth/sessions";
import { scoutActivity } from "@/services/couchbase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every account with what a manager needs to act on it: role, status, last
 * sign-in, live sessions, scouting submissions, and (computed here, per
 * account) whether the requesting user may change it and to which roles.
 */
export async function GET(request: Request) {
  const checked = await guard(request, { permission: "users:read", action: "users.list" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const actor = checked.viewer.principal;
  const [users, sessions, activity] = await Promise.all([listUsers(auth.store), auth.store.list<SessionDoc>(SESSION_PREFIX), scoutActivity()]);
  const now = Date.now();
  const live = new Map<string, number>();
  for (const { body } of sessions) {
    if (body?.type === "auth_session" && Date.parse(body.expiresAt) > now && Date.parse(body.lastSeenAt) + auth.config.sessionIdleMs > now) live.set(body.userId, (live.get(body.userId) ?? 0) + 1);
  }
  const roles = assignableRoles(actor);
  return json({
    users: users.map(({ id, user }) => {
      const manageable = canManageUser(actor, principalFor(auth.config, id, user));
      const scouting = user.scoutName ? activity.get(user.scoutName.trim().toLowerCase()) : undefined;
      return { ...publicUser(auth.config, id, user, "admin"), activeSessions: live.get(id) ?? 0, scouting: scouting ?? null, manageable, assignableRoles: manageable ? roles : [] };
    }).sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || a.displayName.localeCompare(b.displayName)),
    viewer: { id: checked.viewer.userId, role: actor.role },
  });
}
