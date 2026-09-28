// The audit log: entries are created by real actions, persisted in the account
// store, readable only with audit:read, filterable and paged newest first,
// free of secrets, and impossible to change through the app.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import * as audit from "../../../app/api/admin/audit/route.ts";
import * as user from "../../../app/api/admin/users/[id]/route.ts";
import { AUDIT_PREFIX, listAudit, recordAudit } from "../../../lib/auth/audit.ts";
import { authRuntime } from "../../../lib/auth/runtime.ts";
import { asUser, startTestAuth, type TestAuth } from "../../helpers/auth.ts";

let auth: TestAuth;
const base = "http://dashboard.test";

before(async () => { auth = await startTestAuth(); auth.apply(); });
after(async () => { await auth.stop(); });

type Page = { entries: Array<{ id: string; action: string; result: string; actor?: { email?: string }; target?: { id?: string }; meta?: Record<string, unknown> }>; next: string | null };
const read = async (who: { cookie: string }, query = "") => {
  const response = await audit.GET(asUser(who, `${base}/api/admin/audit${query}`));
  return { status: response.status, body: await response.json() as Page };
};

test("creation and persistence: an admin action produces an entry that is stored and read back", async () => {
  const admin = await auth.user("ADMIN");
  const scout = await auth.user("SCOUT");
  await user.PATCH(asUser(admin, `${base}/api/admin/users/${scout.userId}`, { method: "PATCH", body: JSON.stringify({ role: "SCOUT_LEAD" }) }), { params: Promise.resolve({ id: scout.userId }) });
  const persisted = [...auth.store.docs.entries()].find(([id, doc]) => id.startsWith(AUDIT_PREFIX) && doc.body?.action === "users.role" && (doc.body?.target as { id?: string })?.id === scout.userId);
  assert.ok(persisted, "written to the account store");
  const body = persisted![1].body!;
  assert.equal(body.result, "success");
  assert.equal((body.actor as { email: string }).email, admin.email);
  assert.equal((body.meta as Record<string, string>).role, "SCOUT → SCOUT_LEAD");
  assert.match(String(body.at), /^\d{4}-\d{2}-\d{2}T/);
  const { body: page } = await read(admin, `?q=${scout.userId}`);
  assert.ok(page.entries.some((entry) => entry.id === persisted![0]));
});

test("access: only ADMIN and ROOT read the log", async () => {
  for (const role of ["MEMBER", "SCOUT", "SCOUT_LEAD"] as const) assert.equal((await read(await auth.user(role))).status, 403, role);
  for (const role of ["ADMIN", "ROOT"] as const) assert.equal((await read(await auth.user(role))).status, 200, role);
});

test("the log is append-only; no route can create, change, or delete entries", async () => {
  const handlers = Object.keys(audit).filter((name) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(name));
  assert.deepEqual(handlers, ["GET"]);
  const routes = readdirSync("app/api/admin", { recursive: true }).map(String).filter((path) => path.includes("audit"));
  assert.deepEqual(routes.sort(), ["audit", "audit/route.ts"]);
});

test("paging and filters: newest first, `next` continues without repeats, and result/action filters apply", async () => {
  const runtime = authRuntime();
  assert.ok(runtime.ok);
  const admin = await auth.user("ADMIN");
  for (let i = 0; i < 7; i += 1) {
    await recordAudit(runtime.store, { action: "test.paging", result: i % 2 ? "failure" : "success", actor: { id: admin.userId }, meta: { index: i } });
    await new Promise((resolve) => setTimeout(resolve, 2)); // distinct millisecond ids
  }
  const first = await read(admin, "?action=test.paging&limit=3");
  assert.deepEqual(first.body.entries.map((entry) => entry.meta?.index), [6, 5, 4]);
  const second = await read(admin, `?action=test.paging&limit=3&before=${first.body.next}`);
  assert.deepEqual(second.body.entries.map((entry) => entry.meta?.index), [3, 2, 1]);
  const failures = await read(admin, "?action=test.paging&result=failure");
  assert.deepEqual(failures.body.entries.map((entry) => entry.meta?.index), [5, 3, 1]);
  assert.equal((await read(admin, "?before=../../user_x")).status, 400);
});

test("secrets never reach the log, even when a caller passes them as metadata", async () => {
  const runtime = authRuntime();
  assert.ok(runtime.ok);
  const id = await recordAudit(runtime.store, { action: "test.secrets", result: "success", reason: "Authorization: Bearer abc.def.ghi failed", meta: { token: "tok-123", sessionCookie: "610_session=u1.xyz", password: "pw", client_secret: "cs", note: "https://user:hunter2@sg.example/db", fine: "kept" } });
  const stored = JSON.stringify(auth.store.docs.get(id!)!.body);
  for (const secret of ["tok-123", "u1.xyz", "\"pw\"", "\"cs\"", "hunter2", "abc.def.ghi"]) assert.equal(stored.includes(secret), false, secret);
  assert.match(stored, /"fine":"kept"/);
});

test("a store outage never breaks the action being audited", async () => {
  const runtime = authRuntime();
  assert.ok(runtime.ok);
  auth.store.unavailable = true;
  try { assert.equal(await recordAudit(runtime.store, { action: "test.outage", result: "success" }), null); }
  finally { auth.store.unavailable = false; }
  assert.ok(await recordAudit(runtime.store, { action: "test.recovered", result: "success" }), "writing works again afterwards");
  assert.equal((await listAudit(runtime.store, { action: "test.recovered" })).entries.length, 1);
  assert.equal((await listAudit(runtime.store, { action: "test.outage" })).entries.length, 0, "nothing half-written during the outage");
});
