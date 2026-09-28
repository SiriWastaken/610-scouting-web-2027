// Every protected API route, called directly (no UI), by every kind of caller.
// Expected statuses are written out by hand from the role model in
// docs/authentication.md. The server's decision depends only on the session
// cookie: forged roles in headers, cookies, or bodies change nothing.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import * as dashboard from "../../app/api/dashboard-documents/route.ts";
import * as session from "../../app/api/auth/session/route.ts";
import * as account from "../../app/api/account/route.ts";
import * as accountSessions from "../../app/api/account/sessions/route.ts";
import * as overview from "../../app/api/admin/overview/route.ts";
import * as diagnostics from "../../app/api/admin/diagnostics/route.ts";
import * as users from "../../app/api/admin/users/route.ts";
import * as user from "../../app/api/admin/users/[id]/route.ts";
import * as userSessions from "../../app/api/admin/users/[id]/sessions/route.ts";
import * as audit from "../../app/api/admin/audit/route.ts";
import { AUDIT_PREFIX } from "../../lib/auth/audit.ts";
import { SESSION_PREFIX } from "../../lib/auth/sessions.ts";
import { useGatewayForApp } from "../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { asUser, startTestAuth, type TestAuth, type TestUser } from "../helpers/auth.ts";

let target: GatewayTarget;
let auth: TestAuth;
const base = "http://dashboard.test";
type Caller = "anonymous" | "malformed" | "expired" | "disabled" | "pending" | "MEMBER" | "SCOUT" | "SCOUT_LEAD" | "ADMIN" | "ROOT";
const callers: Partial<Record<Caller, { cookie: string } | null>> = {};
let subject: TestUser; // a MEMBER everyone with users:manage may act on

before(async () => {
  target = await startGatewayTarget();
  useGatewayForApp(target);
  auth = await startTestAuth();
  callers.anonymous = null;
  callers.malformed = { cookie: "610_session=not-a-session" };
  for (const role of ["MEMBER", "SCOUT", "SCOUT_LEAD", "ADMIN", "ROOT"] as const) callers[role] = await auth.user(role);
  callers.pending = await auth.user("ADMIN", { status: "pending" });
  callers.disabled = await auth.user("ROOT", { status: "disabled" });
  const expired = await auth.user("ADMIN");
  const sessionId = [...auth.store.docs.keys()].find((id) => id.startsWith(`${SESSION_PREFIX}${expired.userId}_`))!;
  const body = auth.store.docs.get(sessionId)!.body!;
  auth.store.put(sessionId, { ...body, lastSeenAt: new Date(Date.now() - 8 * 24 * 3_600_000).toISOString() });
  callers.expired = expired;
  subject = await auth.user("MEMBER");
});
after(async () => { await auth.stop(); await target.stop(); });

type Call = (who: { cookie: string } | null) => Promise<Response>;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const routes: Record<string, Call> = {
  "GET /api/dashboard-documents": (who) => dashboard.GET(asUser(who, `${base}/api/dashboard-documents?kind=pit&team=610`)),
  "GET /api/auth/session": (who) => session.GET(asUser(who, `${base}/api/auth/session`)),
  "GET /api/account": (who) => account.GET(asUser(who, `${base}/api/account`)),
  "PATCH /api/account": (who) => account.PATCH(asUser(who, `${base}/api/account`, { method: "PATCH", body: JSON.stringify({ scoutName: "Matrix" }) })),
  "DELETE /api/account/sessions": (who) => accountSessions.DELETE(asUser(who, `${base}/api/account/sessions`, { method: "DELETE" })),
  "GET /api/admin/overview": (who) => overview.GET(asUser(who, `${base}/api/admin/overview`)),
  "POST /api/admin/diagnostics": (who) => diagnostics.POST(asUser(who, `${base}/api/admin/diagnostics`, { method: "POST" })),
  "GET /api/admin/users": (who) => users.GET(asUser(who, `${base}/api/admin/users`)),
  "GET /api/admin/users/:id": (who) => user.GET(asUser(who, `${base}/api/admin/users/${subject.userId}`), ctx(subject.userId)),
  "PATCH /api/admin/users/:id": (who) => user.PATCH(asUser(who, `${base}/api/admin/users/${subject.userId}`, { method: "PATCH", body: JSON.stringify({ adminNote: "matrix" }) }), ctx(subject.userId)),
  "DELETE /api/admin/users/:id/sessions": (who) => userSessions.DELETE(asUser(who, `${base}/api/admin/users/${subject.userId}/sessions`, { method: "DELETE" }), ctx(subject.userId)),
  "GET /api/admin/audit": (who) => audit.GET(asUser(who, `${base}/api/admin/audit`)),
};

// Hand-written: 401 = not signed in, 403 = signed in but not allowed.
const NO = { anonymous: 401, malformed: 401, expired: 401, disabled: 401 } as const;
const expected: Record<string, Record<Caller, number>> = {
  "GET /api/dashboard-documents": { ...NO, pending: 403, MEMBER: 200, SCOUT: 200, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "GET /api/auth/session": { ...NO, pending: 200, MEMBER: 200, SCOUT: 200, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "GET /api/account": { ...NO, pending: 200, MEMBER: 200, SCOUT: 200, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "PATCH /api/account": { ...NO, pending: 200, MEMBER: 200, SCOUT: 200, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "DELETE /api/account/sessions": { ...NO, pending: 200, MEMBER: 200, SCOUT: 200, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "GET /api/admin/overview": { ...NO, pending: 403, MEMBER: 403, SCOUT: 403, SCOUT_LEAD: 403, ADMIN: 200, ROOT: 200 },
  "POST /api/admin/diagnostics": { ...NO, pending: 403, MEMBER: 403, SCOUT: 403, SCOUT_LEAD: 403, ADMIN: 200, ROOT: 200 },
  "GET /api/admin/users": { ...NO, pending: 403, MEMBER: 403, SCOUT: 403, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "GET /api/admin/users/:id": { ...NO, pending: 403, MEMBER: 403, SCOUT: 403, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "PATCH /api/admin/users/:id": { ...NO, pending: 403, MEMBER: 403, SCOUT: 403, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "DELETE /api/admin/users/:id/sessions": { ...NO, pending: 403, MEMBER: 403, SCOUT: 403, SCOUT_LEAD: 200, ADMIN: 200, ROOT: 200 },
  "GET /api/admin/audit": { ...NO, pending: 403, MEMBER: 403, SCOUT: 403, SCOUT_LEAD: 403, ADMIN: 200, ROOT: 200 },
};

test("matrix: every protected route answers every caller exactly as the role model says", async () => {
  const mismatches: string[] = [];
  for (const [route, call] of Object.entries(routes)) {
    for (const caller of Object.keys(expected[route]) as Caller[]) {
      const response = await call(callers[caller] ?? null);
      if (response.status !== expected[route][caller]) mismatches.push(`${route} as ${caller}: ${response.status}, expected ${expected[route][caller]}`);
      // The session endpoint is public by design: its 401 tells the welcome screen which providers exist.
      if ((response.status === 401 || response.status === 403) && route !== "GET /api/auth/session") {
        const body = await response.json() as Record<string, unknown>;
        if (Object.keys(body).some((key) => !["error", "message"].includes(key))) mismatches.push(`${route} as ${caller}: a refusal leaked ${JSON.stringify(body).slice(0, 120)}`);
      }
    }
  }
  assert.deepEqual(mismatches, []);
});

test("forged identity: role headers, extra cookies, and body fields never raise privileges", async () => {
  const member = callers.MEMBER!;
  const forgedHeaders = { "X-User-Role": "ROOT", "X-Role": "ADMIN", Authorization: "Bearer admin", "X-Forwarded-User": "root@team610.test" };
  const forged = { cookie: `${member.cookie}; role=ROOT; admin=true; 610_role=ADMIN` };
  const overviewResponse = await overview.GET(asUser(forged, `${base}/api/admin/overview`, { headers: forgedHeaders }));
  assert.equal(overviewResponse.status, 403);
  const patch = await user.PATCH(asUser(forged, `${base}/api/admin/users/${subject.userId}`, { method: "PATCH", headers: forgedHeaders, body: JSON.stringify({ role: "ADMIN", actorRole: "ROOT" }) }), ctx(subject.userId));
  assert.equal(patch.status, 403);
  const sessionBody = await (await session.GET(asUser(forged, `${base}/api/auth/session`, { headers: forgedHeaders }))).json() as { user: { role: string }; permissions: Record<string, boolean> };
  assert.equal(sessionBody.user.role, "MEMBER");
  assert.equal(sessionBody.permissions["ops:read"], false);
});

test("self-elevation: a user cannot change their own role or status through any route", async () => {
  for (const caller of ["MEMBER", "SCOUT_LEAD", "ADMIN", "ROOT"] as const) {
    const me = callers[caller] as TestUser;
    const viaAdmin = await user.PATCH(asUser(me, `${base}/api/admin/users/${me.userId}`, { method: "PATCH", body: JSON.stringify({ role: "ROOT" }) }), ctx(me.userId));
    assert.equal(viaAdmin.status, 403, `${caller} via admin route`);
    const viaProfile = await account.PATCH(asUser(me, `${base}/api/account`, { method: "PATCH", body: JSON.stringify({ displayName: "Me", role: "ROOT" }) }));
    assert.equal(viaProfile.status, 400, `${caller} via profile route`);
    const after = await (await session.GET(asUser(me, `${base}/api/auth/session`))).json() as { user: { role: string } };
    assert.equal(after.user.role, caller);
  }
  const auditEntries = [...auth.store.docs.values()].filter((doc) => !doc.deleted && doc.body?.type === "audit").map((doc) => doc.body!);
  assert.ok(auditEntries.some((entry) => entry.action === "account.update" && entry.result === "denied" && String(entry.reason).includes("role")), "the forged profile field is audited");
});

test("IDOR: account routes only ever return the caller's own account; other accounts need users:read", async () => {
  const scout = callers.SCOUT as TestUser;
  const own = await (await account.GET(asUser(scout, `${base}/api/account`))).json() as { user: { id: string }; sessions: unknown[] };
  assert.equal(own.user.id, scout.userId);
  // Query strings and bodies cannot redirect it to someone else.
  const other = await (await account.GET(asUser(scout, `${base}/api/account?id=${subject.userId}&userId=${subject.userId}`))).json() as { user: { id: string } };
  assert.equal(other.user.id, scout.userId);
  assert.equal((await user.GET(asUser(scout, `${base}/api/admin/users/${subject.userId}`), ctx(subject.userId))).status, 403);
  // A scout lead may read an admin's record but not change it.
  const admin = callers.ADMIN as TestUser;
  assert.equal((await user.GET(asUser(callers.SCOUT_LEAD!, `${base}/api/admin/users/${admin.userId}`), ctx(admin.userId))).status, 200);
  assert.equal((await user.PATCH(asUser(callers.SCOUT_LEAD!, `${base}/api/admin/users/${admin.userId}`, { method: "PATCH", body: JSON.stringify({ displayName: "Pwned" }) }), ctx(admin.userId))).status, 403);
  assert.equal((await userSessions.DELETE(asUser(callers.SCOUT_LEAD!, `${base}/api/admin/users/${admin.userId}/sessions`, { method: "DELETE" }), ctx(admin.userId))).status, 403);
  for (const bad of ["../user_x", "u123", "", "user_" + admin.userId]) assert.equal((await user.GET(asUser(callers.ROOT!, `${base}/api/admin/users/x`), ctx(bad))).status, 404, bad);
});

test("CSRF: state-changing requests from another origin, or with no Origin, are refused before anything changes", async () => {
  const root = callers.ROOT!;
  const before = JSON.stringify(auth.store.docs.get(`user_${subject.userId}`));
  for (const origin of ["https://evil.example", "", "null", "http://dashboard.test.evil.example"]) {
    const request = new Request(`${base}/api/admin/users/${subject.userId}`, { method: "PATCH", headers: { cookie: root.cookie, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ status: "disabled" }) });
    assert.equal((await user.PATCH(request, ctx(subject.userId))).status, 403, `origin ${JSON.stringify(origin)}`);
  }
  assert.equal(JSON.stringify(auth.store.docs.get(`user_${subject.userId}`)), before);
  const text = await user.PATCH(new Request(`${base}/api/admin/users/${subject.userId}`, { method: "PATCH", headers: { cookie: root.cookie, origin: base, "content-type": "text/plain" }, body: JSON.stringify({ displayName: "x" }) }), ctx(subject.userId));
  assert.equal(text.status, 400, "only JSON bodies are read (a cross-site form cannot send JSON)");
});

test("denied admin API calls are audited (and repeated denials are rate-limited)", async () => {
  const scout = callers.SCOUT as TestUser;
  const count = () => [...auth.store.docs.entries()].filter(([id, doc]) => id.startsWith(AUDIT_PREFIX) && !doc.deleted && doc.body?.action === "audit.read" && (doc.body?.actor as { id?: string })?.id === scout.userId).length;
  const before = count();
  for (let i = 0; i < 5; i += 1) assert.equal((await audit.GET(asUser(scout, `${base}/api/admin/audit`))).status, 403);
  assert.equal(count() - before, before === 0 ? 1 : 0, "one entry per minute per caller and action");
});

test("structure: every admin and account API route runs the guard, and admin routes name a permission", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name === "route.ts" ? [join(dir, entry.name)] : []);
  for (const file of [...walk("app/api/admin"), ...walk("app/api/account"), "app/api/dashboard-documents/route.ts"]) {
    const source = readFileSync(file, "utf8");
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
    const guards = [...source.matchAll(/await guard\(request, \{/g)].length;
    assert.equal(guards, handlers, `${file}: every handler must call guard() first`);
    if (file.startsWith("app/api/admin") || file.includes("dashboard")) assert.equal([...source.matchAll(/guard\(request, \{ permission: "/g)].length, handlers, `${file}: every handler needs a permission`);
  }
});
