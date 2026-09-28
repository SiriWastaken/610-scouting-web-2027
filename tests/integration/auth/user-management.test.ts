// Account management through the real admin routes: listing, editing names,
// role changes (valid, invalid, unauthorized), ROOT protections, approving,
// disabling, and revoking sessions. Every change is read back from the store.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import * as users from "../../../app/api/admin/users/route.ts";
import * as user from "../../../app/api/admin/users/[id]/route.ts";
import * as userSessions from "../../../app/api/admin/users/[id]/sessions/route.ts";
import * as session from "../../../app/api/auth/session/route.ts";
import { AUDIT_PREFIX } from "../../../lib/auth/audit.ts";
import { useGatewayForApp } from "../../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { asUser, CONFIGURED_ROOT, startTestAuth, type TestAuth, type TestUser } from "../../helpers/auth.ts";

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
  const admin = await auth.user("ADMIN");
  const scout = await auth.user("SCOUT", { name: "Listed Scout" });
  const peer = await auth.user("ADMIN");
  const response = await users.GET(asUser(admin, `${base}/api/admin/users`));
  assert.equal(response.status, 200);
  const body = await response.json() as { users: Array<{ id: string; displayName: string; role: string; activeSessions: number; manageable: boolean; assignableRoles: string[] }> };
  const row = body.users.find((entry) => entry.id === scout.userId)!;
  assert.deepEqual({ name: row.displayName, role: row.role, sessions: row.activeSessions, manageable: row.manageable, roles: row.assignableRoles }, { name: "Listed Scout", role: "SCOUT", sessions: 1, manageable: true, roles: ["MEMBER", "SCOUT", "SCOUT_LEAD"] });
  const peerRow = body.users.find((entry) => entry.id === peer.userId)!;
  assert.deepEqual({ manageable: peerRow.manageable, roles: peerRow.assignableRoles }, { manageable: false, roles: [] }, "admins cannot manage other admins");
  assert.equal(body.users.find((entry) => entry.id === admin.userId)!.manageable, false, "nor themselves");
  assert.equal(JSON.stringify(body).includes(scout.token.split(".")[1]), false, "no session tokens in the listing");
});

test("editing names: an admin changes display name, scout name, and note; each is persisted and audited", async () => {
  const admin = await auth.user("ADMIN");
  const scout = await auth.user("SCOUT");
  const result = await patch(admin, scout.userId, { displayName: "Renamed Scout", scoutName: "R. Scout", adminNote: "Pit crew on day 2" });
  assert.equal(result.status, 200);
  assert.deepEqual({ name: stored(scout.userId)!.displayName, scout: stored(scout.userId)!.scoutName, note: stored(scout.userId)!.adminNote }, { name: "Renamed Scout", scout: "R. Scout", note: "Pit crew on day 2" });
  const me = await (await session.GET(asUser(scout, `${base}/api/auth/session`))).json() as { user: { displayName: string; scoutName: string } };
  assert.equal(me.user.displayName, "Renamed Scout", "the user sees it on their next request");
  const entry = auditFor(scout.userId).find((item) => item.action === "users.update" && item.result === "success");
  assert.ok(entry);
  assert.equal((entry!.meta as Record<string, string>).adminNote, "(changed)", "note contents are not copied into the audit log");
  const cleared = await patch(admin, scout.userId, { scoutName: null, adminNote: "" });
  assert.equal(cleared.status, 200);
  assert.equal(stored(scout.userId)!.scoutName, undefined);
});

test("role changes: allowed grants apply immediately; grants above your level are refused and audited", async () => {
  const admin = await auth.user("ADMIN");
  const lead = await auth.user("SCOUT_LEAD");
  const member = await auth.user("MEMBER");
  assert.equal((await patch(lead, member.userId, { role: "SCOUT" })).status, 200);
  assert.equal(stored(member.userId)!.role, "SCOUT");
  const me = await (await session.GET(asUser(member, `${base}/api/auth/session`))).json() as { user: { role: string } };
  assert.equal(me.user.role, "SCOUT", "no need to sign in again");
  const tooHigh = await patch(lead, member.userId, { role: "SCOUT_LEAD" });
  assert.deepEqual({ status: tooHigh.status, error: tooHigh.body.error }, { status: 403, error: "forbidden" });
  assert.equal((await patch(admin, member.userId, { role: "ADMIN" })).status, 403, "admins cannot create admins");
  assert.equal((await patch(admin, member.userId, { role: "SCOUT_LEAD" })).status, 200);
  assert.equal((await patch(lead, member.userId, { role: "MEMBER" })).status, 403, "a lead cannot demote another lead");
  assert.equal(stored(member.userId)!.role, "SCOUT_LEAD");
  assert.ok(auditFor(member.userId).some((entry) => entry.action === "users.role" && entry.result === "denied"));
  assert.ok(auditFor(member.userId).some((entry) => entry.action === "users.role" && entry.result === "success" && String((entry.meta as Record<string, string>).role) === "SCOUT → SCOUT_LEAD"));
});

test("invalid changes are rejected with 400 and nothing is written", async () => {
  const root = await auth.user("ROOT");
  const member = await auth.user("MEMBER");
  const before = JSON.stringify(stored(member.userId));
  for (const body of [{ role: "SUPERADMIN" }, { status: "banned" }, { displayName: "" }, { email: "x@evil.example" }, { role: "ADMIN", id: "someone" }, {}]) {
    assert.equal((await patch(root, member.userId, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(JSON.stringify(stored(member.userId)), before);
  assert.equal((await patch(root, "u00000000000000000000", { displayName: "Ghost" })).status, 404);
});

test("ROOT protections: configured roots are immutable from the app; only ROOT manages admins and roots", async () => {
  const root = await auth.user("ROOT");
  const configured = await auth.user("ROOT", { email: CONFIGURED_ROOT });
  const admin = await auth.user("ADMIN");
  for (const body of [{ role: "MEMBER" }, { status: "disabled" }, { displayName: "Renamed" }]) {
    const result = await patch(root, configured.userId, body);
    assert.equal(result.status, 403, JSON.stringify(body));
    assert.match(result.body.message!, /AUTH_ROOT_EMAILS/);
  }
  assert.equal((await patch(admin, root.userId, { role: "MEMBER" })).status, 403, "an admin cannot demote a root");
  assert.equal((await patch(admin, root.userId, { status: "disabled" })).status, 403, "or disable one");
  // ROOT may promote to ADMIN and ROOT, and demote a non-configured ROOT.
  const promoted = await auth.user("SCOUT");
  assert.equal((await patch(root, promoted.userId, { role: "ROOT" })).status, 200);
  assert.equal((await patch(root, promoted.userId, { role: "ADMIN" })).status, 200);
  assert.equal(stored(promoted.userId)!.role, "ADMIN");
});

test("last ROOT: the final active root cannot be demoted or disabled, even by another root", async () => {
  // A fresh deployment with no AUTH_ROOT_EMAILS, so the only roots are the two made here.
  const isolated = await startTestAuth();
  isolated.apply();
  process.env.AUTH_ROOT_EMAILS = "";
  try {
    const first = await isolated.user("ROOT");
    const second = await isolated.user("ROOT");
    process.env.AUTH_ROOT_EMAILS = "";
    assert.equal((await patch(first, second.userId, { role: "ADMIN" })).status, 200, "with two roots, one may step the other down");
    assert.equal((await patch(second, first.userId, { role: "ADMIN" })).status, 403, "the new admin cannot touch the remaining root");
    // `first` is now the last active root. The rule holds for any root principal, not only the ones that exist.
    const { adminUpdateUser, AccountError } = await import("../../../lib/auth/accounts.ts");
    const { authRuntime } = await import("../../../lib/auth/runtime.ts");
    const runtime = authRuntime();
    assert.ok(runtime.ok);
    const otherRoot = { id: "u-hypothetical-root", role: "ROOT" as const, status: "active" as const };
    for (const change of [{ role: "ADMIN" as const }, { status: "disabled" as const }, { status: "pending" as const }]) {
      await assert.rejects(adminUpdateUser(runtime.store, runtime.config, otherRoot, first.userId, change), (error: unknown) => error instanceof AccountError && error.code === "last_root", JSON.stringify(change));
    }
    assert.deepEqual({ role: isolated.store.docs.get(`user_${first.userId}`)!.body!.role, status: isolated.store.docs.get(`user_${first.userId}`)!.body!.status }, { role: "ROOT", status: "active" });
    // Once another root exists, the change is allowed.
    await isolated.user("ROOT");
    process.env.AUTH_ROOT_EMAILS = "";
    await adminUpdateUser(runtime.store, runtime.config, otherRoot, first.userId, { role: "ADMIN" });
  } finally { auth.apply(); await isolated.stop(); }
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
  const admin = await auth.user("ADMIN");
  const scout = await auth.user("SCOUT");
  assert.equal(await sessionStatus(scout), 200);
  const result = await patch(admin, scout.userId, { status: "disabled" });
  assert.equal(result.status, 200);
  assert.equal(await sessionStatus(scout), 401);
  assert.ok(auditFor(scout.userId).some((entry) => entry.action === "users.status" && (entry.meta as Record<string, number>).sessionsRevoked === 1));
  assert.equal((await patch(admin, scout.userId, { status: "active" })).status, 200);
  assert.equal(await sessionStatus(scout), 401, "they must sign in again");
});

test("revoking sessions: ends every session of a manageable account, refused for others", async () => {
  const lead = await auth.user("SCOUT_LEAD");
  const scout = await auth.user("SCOUT");
  const admin = await auth.user("ADMIN");
  const response = await userSessions.DELETE(asUser(lead, `${base}/api/admin/users/${scout.userId}/sessions`, { method: "DELETE" }), ctx(scout.userId));
  assert.deepEqual(await response.json(), { revoked: 1 });
  assert.equal(await sessionStatus(scout), 401);
  assert.equal((await userSessions.DELETE(asUser(lead, `${base}/api/admin/users/${admin.userId}/sessions`, { method: "DELETE" }), ctx(admin.userId))).status, 403);
  assert.equal(await sessionStatus(admin), 200);
});

test("concurrent edits: a change based on an old revision is refused with 409 instead of overwriting", async () => {
  const root = await auth.user("ROOT");
  const member = await auth.user("MEMBER");
  const detail = await (await user.GET(asUser(root, `${base}/api/admin/users/${member.userId}`), ctx(member.userId))).json() as { user: { rev: string } };
  assert.equal((await patch(root, member.userId, { displayName: "First", expectedRev: detail.user.rev })).status, 200);
  const stale = await patch(root, member.userId, { displayName: "Second", expectedRev: detail.user.rev });
  assert.deepEqual({ status: stale.status, error: stale.body.error }, { status: 409, error: "conflict" });
  assert.equal(stored(member.userId)!.displayName, "First");
});
