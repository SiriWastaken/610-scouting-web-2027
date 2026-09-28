// Account management through the real admin routes: listing, names (Owner
// only), role changes (valid, invalid, unauthorized), Owner protections,
// approving, disabling, and revoking sessions. Every change is read back from the store.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as users from "../../../app/api/admin/users/route.ts";
import * as user from "../../../app/api/admin/users/[id]/route.ts";
import * as userSessions from "../../../app/api/admin/users/[id]/sessions/route.ts";
import * as session from "../../../app/api/auth/session/route.ts";
import { AUDIT_PREFIX } from "../../../lib/auth/audit.ts";
import { useGatewayForApp } from "../../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { asUser, CONFIGURED_OWNER, startTestAuth, type TestAuth, type TestUser } from "../../helpers/auth.ts";

let target: GatewayTarget;
let auth: TestAuth;
const base = "http://dashboard.test";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

before(async () => { target = await startGatewayTarget(); useGatewayForApp(target); auth = await startTestAuth(); auth.apply(); });
after(async () => { await auth.stop(); await target.stop(); });

async function patch(actor: TestUser, targetId: string, body: Record<string, unknown>) {
  const response = await user.PATCH(asUser(actor, `${base}/api/admin/users/${targetId}`, { method: "PATCH", body: JSON.stringify(body) }), ctx(targetId));
  return { status: response.status, body: await response.json() as { error?: string; message?: string; user?: { role: string; status: string; displayName: string; scoutName: string | null; adminNote: string | null; rev: string } } };
}
const stored = (id: string) => auth.store.docs.get(`user_${id}`)?.body as { role: string; status: string; displayName: string; scoutName?: string; adminNote?: string; approvedBy?: string } | undefined;
const sessionStatus = async (who: TestUser) => (await session.GET(asUser(who, `${base}/api/auth/session`))).status;
const auditFor = (id: string) => [...auth.store.docs.entries()].filter(([key, doc]) => key.startsWith(AUDIT_PREFIX) && !doc.deleted && (doc.body?.target as { id?: string })?.id === id).map(([, doc]) => doc.body!);

test("listing: every account with role, status, sessions, and what the viewer may do to it", async () => {
  const mentor = await auth.user("MENTOR");
  const scout = await auth.user("SCOUT", { name: "Listed Scout" });
  const peer = await auth.user("MENTOR");
  const response = await users.GET(asUser(mentor, `${base}/api/admin/users`));
  assert.equal(response.status, 200);
  const body = await response.json() as { users: Array<{ id: string; displayName: string; role: string; activeSessions: number; manageable: boolean; assignableRoles: string[] }> };
  const row = body.users.find((entry) => entry.id === scout.userId)!;
  assert.deepEqual({ name: row.displayName, role: row.role, sessions: row.activeSessions, manageable: row.manageable, roles: row.assignableRoles }, { name: "Listed Scout", role: "SCOUT", sessions: 1, manageable: true, roles: ["MEMBER", "SCOUT", "SCOUT_LEAD"] });
  const peerRow = body.users.find((entry) => entry.id === peer.userId)!;
  assert.deepEqual({ manageable: peerRow.manageable, roles: peerRow.assignableRoles }, { manageable: false, roles: [] }, "mentors cannot manage other mentors");
  assert.equal(body.users.find((entry) => entry.id === mentor.userId)!.manageable, false, "nor themselves");
  assert.equal(JSON.stringify(body).includes(scout.token.split(".")[1]), false, "no session tokens in the listing");
});

test("names: the Owner changes display and scout names; the note stays a manager field; each is persisted and audited", async () => {
  const owner = await auth.user("OWNER");
  const mentor = await auth.user("MENTOR");
  const scout = await auth.user("SCOUT");
  const refused = await patch(mentor, scout.userId, { displayName: "Renamed Scout" });
  assert.deepEqual({ status: refused.status, message: refused.body.message }, { status: 403, message: "Only the Owner can change names" });
  assert.ok(auditFor(scout.userId).some((entry) => entry.action === "users.update" && entry.result === "denied"), "the refused rename is audited");
  const result = await patch(owner, scout.userId, { displayName: "Renamed Scout", scoutName: "R. Scout", adminNote: "Pit crew on day 2" });
  assert.equal(result.status, 200);
  assert.deepEqual({ name: stored(scout.userId)!.displayName, scout: stored(scout.userId)!.scoutName, note: stored(scout.userId)!.adminNote }, { name: "Renamed Scout", scout: "R. Scout", note: "Pit crew on day 2" });
  const me = await (await session.GET(asUser(scout, `${base}/api/auth/session`))).json() as { user: { displayName: string; scoutName: string } };
  assert.equal(me.user.displayName, "Renamed Scout", "the user sees it on their next request");
  const entry = auditFor(scout.userId).find((item) => item.action === "users.update" && item.result === "success");
  assert.ok(entry);
  assert.equal((entry!.meta as Record<string, string>).adminNote, "(changed)", "note contents are not copied into the audit log");
  assert.equal((await patch(mentor, scout.userId, { adminNote: "" })).status, 200, "a mentor may clear the note");
  const cleared = await patch(owner, scout.userId, { scoutName: null });
  assert.equal(cleared.status, 200);
  assert.equal(stored(scout.userId)!.scoutName, undefined);
});

test("role changes: allowed grants apply immediately; grants at or above your level are refused and audited", async () => {
  const owner = await auth.user("OWNER");
  const mentor = await auth.user("MENTOR");
  const lead = await auth.user("SCOUT_LEAD");
  const member = await auth.user("MEMBER");
  assert.equal((await patch(lead, member.userId, { role: "SCOUT" })).status, 200);
  assert.equal(stored(member.userId)!.role, "SCOUT");
  const me = await (await session.GET(asUser(member, `${base}/api/auth/session`))).json() as { user: { role: string } };
  assert.equal(me.user.role, "SCOUT", "no need to sign in again");
  const tooHigh = await patch(lead, member.userId, { role: "SCOUT_LEAD" });
  assert.deepEqual({ status: tooHigh.status, error: tooHigh.body.error }, { status: 403, error: "forbidden" });
  assert.equal((await patch(mentor, member.userId, { role: "MENTOR" })).status, 403, "mentors cannot create mentors");
  assert.equal((await patch(mentor, member.userId, { role: "SCOUT_LEAD" })).status, 200);
  assert.equal((await patch(lead, member.userId, { role: "MEMBER" })).status, 403, "a lead cannot demote another lead");
  assert.equal(stored(member.userId)!.role, "SCOUT_LEAD");
  assert.equal((await patch(owner, member.userId, { role: "MENTOR" })).status, 200, "only the Owner makes mentors");
  assert.equal(stored(member.userId)!.role, "MENTOR");
  assert.ok(auditFor(member.userId).some((entry) => entry.action === "users.role" && entry.result === "denied"));
  assert.ok(auditFor(member.userId).some((entry) => entry.action === "users.role" && entry.result === "success" && String((entry.meta as Record<string, string>).role) === "SCOUT → SCOUT_LEAD"));
});

test("invalid changes are rejected with 400 and nothing is written", async () => {
  const owner = await auth.user("OWNER");
  const member = await auth.user("MEMBER");
  const before = JSON.stringify(stored(member.userId));
  for (const body of [{ role: "SUPERADMIN" }, { role: "OWNER" }, { role: "ADMIN" }, { status: "banned" }, { displayName: "" }, { email: "x@evil.example" }, { role: "MENTOR", id: "someone" }, {}]) {
    assert.equal((await patch(owner, member.userId, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(JSON.stringify(stored(member.userId)), before);
  assert.equal((await patch(owner, "u00000000000000000000", { adminNote: "Ghost" })).status, 404);
});

test("Owner protections: the configured Owner can't be changed from the app, not even by themselves", async () => {
  const owner = await auth.user("OWNER");
  const mentor = await auth.user("MENTOR");
  for (const [actor, body] of [[mentor, { role: "MEMBER" }], [mentor, { status: "disabled" }], [mentor, { adminNote: "x" }], [owner, { role: "MEMBER" }], [owner, { status: "disabled" }]] as const) {
    const result = await patch(actor, owner.userId, body);
    assert.equal(result.status, 403, JSON.stringify(body));
  }
  assert.match((await patch(mentor, owner.userId, { status: "disabled" })).body.message!, /AUTH_OWNER_EMAILS/);
  assert.equal(owner.email, CONFIGURED_OWNER);
  const me = await (await session.GET(asUser(owner, `${base}/api/auth/session`))).json() as { user: { role: string; status: string } };
  assert.deepEqual({ role: me.user.role, status: me.user.status }, { role: "OWNER", status: "active" });
});

test("ownership never comes from the database: a stored OWNER, ROOT, or ADMIN role is only a MENTOR", async () => {
  for (const legacy of ["OWNER", "ROOT", "ADMIN"]) {
    const someone = await auth.user("MEMBER");
    const current = auth.store.docs.get(`user_${someone.userId}`)!;
    auth.store.put(`user_${someone.userId}`, { ...current.body!, role: legacy });
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("610-scouting.session-cache")];
    const me = await (await session.GET(asUser(someone, `${base}/api/auth/session`))).json() as { user: { role: string }; permissions: Record<string, boolean> };
    assert.equal(me.user.role, "MENTOR", legacy);
    assert.equal(me.permissions["users:rename"], false, `${legacy} cannot rename`);
  }
});

test("approval: a lead approves a pending account, which can then read the dashboard", async () => {
  const lead = await auth.user("SCOUT_LEAD");
  const pending = await auth.user("MEMBER", { status: "pending" });
  const dashboard = await import("../../../app/api/dashboard-documents/route.ts");
  assert.equal((await dashboard.GET(asUser(pending, `${base}/api/dashboard-documents?kind=pit&team=610`))).status, 403);
  assert.equal((await patch(lead, pending.userId, { status: "active" })).status, 200);
  assert.equal(stored(pending.userId)!.approvedBy, lead.userId);
  assert.equal((await dashboard.GET(asUser(pending, `${base}/api/dashboard-documents?kind=pit&team=610`))).status, 200);
});

test("disabling: signs the account out everywhere at once; re-enabling does not bring old sessions back", async () => {
  const mentor = await auth.user("MENTOR");
  const scout = await auth.user("SCOUT");
  assert.equal(await sessionStatus(scout), 200);
  const result = await patch(mentor, scout.userId, { status: "disabled" });
  assert.equal(result.status, 200);
  assert.equal(await sessionStatus(scout), 401);
  assert.ok(auditFor(scout.userId).some((entry) => entry.action === "users.status" && (entry.meta as Record<string, number>).sessionsRevoked === 1));
  assert.equal((await patch(mentor, scout.userId, { status: "active" })).status, 200);
  assert.equal(await sessionStatus(scout), 401, "they must sign in again");
});

test("revoking sessions: ends every session of a manageable account, refused for others", async () => {
  const lead = await auth.user("SCOUT_LEAD");
  const scout = await auth.user("SCOUT");
  const mentor = await auth.user("MENTOR");
  const response = await userSessions.DELETE(asUser(lead, `${base}/api/admin/users/${scout.userId}/sessions`, { method: "DELETE" }), ctx(scout.userId));
  assert.deepEqual(await response.json(), { revoked: 1 });
  assert.equal(await sessionStatus(scout), 401);
  assert.equal((await userSessions.DELETE(asUser(lead, `${base}/api/admin/users/${mentor.userId}/sessions`, { method: "DELETE" }), ctx(mentor.userId))).status, 403);
  assert.equal(await sessionStatus(mentor), 200);
});

test("concurrent edits: a change based on an old revision is refused with 409 instead of overwriting", async () => {
  const owner = await auth.user("OWNER");
  const member = await auth.user("MEMBER");
  const detail = await (await user.GET(asUser(owner, `${base}/api/admin/users/${member.userId}`), ctx(member.userId))).json() as { user: { rev: string } };
  assert.equal((await patch(owner, member.userId, { displayName: "First", expectedRev: detail.user.rev })).status, 200);
  const stale = await patch(owner, member.userId, { displayName: "Second", expectedRev: detail.user.rev });
  assert.deepEqual({ status: stale.status, error: stale.body.error }, { status: 409, error: "conflict" });
  assert.equal(stored(member.userId)!.displayName, "First");
});
