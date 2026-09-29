// Session lifecycle through the real handlers and account store: persistence,
// idle and absolute expiry (on a mocked clock), sign-out, revocation, and what
// happens when the store is unreachable.
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { GET as sessionRoute } from "../../../app/api/auth/session/route.ts";
import { POST as signOutRoute } from "../../../app/api/auth/signout/route.ts";
import { GET as accountRoute } from "../../../app/api/account/route.ts";
import { DELETE as signOutOthers } from "../../../app/api/account/sessions/route.ts";
import { GET as dashboardRoute } from "../../../app/api/dashboard-documents/route.ts";
import { authRuntime } from "../../../lib/auth/requests.ts";
import { SESSION_PREFIX, validateSession } from "../../../lib/auth/sessions.ts";
import { asUser, startTestAuth, type TestAuth } from "../../helpers/auth.ts";

let auth: TestAuth;
const base = "http://dashboard.test";
const DAY = 24 * 3_600_000;

before(async () => {
  auth = await startTestAuth();
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-03-01T08:00:00Z") });
});
beforeEach(() => { auth.apply(); mock.timers.tick(11_000); /* past the 10 s session cache */ });
after(async () => { mock.timers.reset(); await auth.stop(); });

const me = async (cookie: string | null) => (await sessionRoute(asUser(cookie ? { cookie } : null, `${base}/api/auth/session`))).status;

test("persistence: a session keeps working across requests and a server restart (fresh process cache)", async () => {
  const user = await auth.user("SCOUT");
  assert.equal(await me(user.cookie), 200);
  // Simulate a restart: the cache is per process; the store is the source of truth.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("610-scouting.session-cache")];
  assert.equal(await me(user.cookie), 200);
  mock.timers.tick(3 * DAY);
  assert.equal(await me(user.cookie), 200, "still valid three days later while in use");
});

test("idle expiry: a session unused for longer than AUTH_SESSION_IDLE_HOURS ends and is deleted", async () => {
  const user = await auth.user("MEMBER");
  mock.timers.tick(7 * DAY + 60_000);
  const response = await sessionRoute(asUser(user, `${base}/api/auth/session`));
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { reason: string }).reason, "expired");
  const dashboard = await dashboardRoute(asUser(user, `${base}/api/dashboard-documents?kind=pit&team=610`));
  assert.equal(dashboard.status, 401, "protected APIs refuse the expired session too");
  assert.equal((await dashboard.json() as { error: string }).error, "signin_required", "the session document was already removed");
  assert.equal([...auth.store.docs.keys()].some((id) => id.startsWith(`${SESSION_PREFIX}${user.userId}_`) && !auth.store.docs.get(id)!.deleted), false);
});

test("sliding idle window: activity extends it, but never past the absolute lifetime", async () => {
  const user = await auth.user("MEMBER");
  // Used on days 6, 12, 18, 24, and 29: each visit is inside the 7-day idle window.
  for (const gap of [6, 6, 6, 6, 5]) { mock.timers.tick(gap * DAY); assert.equal(await me(user.cookie), 200); }
  mock.timers.tick(2 * DAY); // day 31: still in use, but past the 30-day maximum
  assert.equal(await me(user.cookie), 401);
});

test("sign-out: ends the session server-side and clears the cookie; the old cookie is useless afterwards", async () => {
  const user = await auth.user("MEMBER");
  const response = await signOutRoute(asUser(user, `${base}/api/auth/signout`, { method: "POST" }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie")!, /^610_session=; Path=\/; Max-Age=0/);
  assert.deepEqual(await response.json(), { ok: true, ended: true });
  assert.equal(await me(user.cookie), 401, "replaying the cookie after sign-out fails");
});

test("sign-out is POST and same-origin only, so another site cannot sign anyone out", async () => {
  const user = await auth.user("MEMBER");
  const crossSite = await signOutRoute(asUser(user, `${base}/api/auth/signout`, { method: "POST", origin: "https://evil.example" }));
  assert.equal(crossSite.status, 403);
  assert.equal(await me(user.cookie), 200);
});

test("sign out other devices keeps this one and ends the rest", async () => {
  const user = await auth.user("SCOUT");
  const runtime = authRuntime();
  assert.ok(runtime.ok);
  const { createSession } = await import("../../../lib/auth/sessions.ts");
  const other = await createSession(runtime.store, runtime.config, user.userId, "apple", "Safari on iOS");
  const otherCookie = `610_session=${other.token}`;
  assert.equal(await me(otherCookie), 200);
  const account = await (await accountRoute(asUser(user, `${base}/api/account`))).json() as { sessions: Array<{ current: boolean; provider: string }> };
  assert.deepEqual(account.sessions.map((entry) => entry.current).sort(), [false, true]);
  const response = await signOutOthers(asUser(user, `${base}/api/account/sessions`, { method: "DELETE" }));
  assert.deepEqual(await response.json(), { revoked: 1 });
  assert.equal(await me(otherCookie), 401);
  assert.equal(await me(user.cookie), 200);
});

test("malformed, forged, and guessed tokens are rejected", async () => {
  const user = await auth.user("MENTOR");
  const [prefix, secret] = user.token.split(".");
  for (const token of ["", "garbage", `${prefix}.`, `${prefix}.${secret}.extra`, `${prefix}.${"A".repeat(43)}`, `u${"0".repeat(20)}.${secret}`, `${prefix}.${secret.slice(0, -1)}B`, "../../etc/passwd"]) {
    assert.equal(await me(`610_session=${token}`), 401, token);
  }
  assert.equal(await me(`__Host-610_session=${user.token}`), 401, "the https cookie name is not read on an http deployment");
});

test("tokens are stored only as hashes", async () => {
  const user = await auth.user("MEMBER");
  const secret = user.token.split(".")[1];
  assert.equal(JSON.stringify([...auth.store.docs.entries()]).includes(secret), false);
});

test("account store outage: the API says unavailable (503), never 'signed out', and recovers by itself", async () => {
  const user = await auth.user("MEMBER");
  auth.store.unavailable = true;
  try {
    assert.equal(await me(user.cookie), 503);
    assert.equal((await dashboardRoute(asUser(user, `${base}/api/dashboard-documents?kind=pit&team=610`))).status, 503);
  } finally { auth.store.unavailable = false; }
  assert.equal(await me(user.cookie), 200);
});

test("the in-process cache never outlives a revocation made in this process", async () => {
  const user = await auth.user("MEMBER");
  const runtime = authRuntime();
  assert.ok(runtime.ok);
  assert.equal((await validateSession(runtime.store, runtime.config, user.token)).ok, true); // cached now
  const { revokeUserSessions } = await import("../../../lib/auth/sessions.ts");
  await revokeUserSessions(runtime.store, user.userId);
  assert.equal((await validateSession(runtime.store, runtime.config, user.token)).ok, false);
});
