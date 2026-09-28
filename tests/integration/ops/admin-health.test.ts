// The admin health view against real (fake) services that are made to fail:
// every status must come from an actual check, and failure must show as failure.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import * as overview from "../../../app/api/admin/overview/route.ts";
import * as diagnostics from "../../../app/api/admin/diagnostics/route.ts";
import { recordError, resetMetrics } from "../../../lib/ops/metrics.ts";
import { useGatewayForApp } from "../../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { asUser, startTestAuth, type TestAuth, type TestUser } from "../../helpers/auth.ts";

let target: GatewayTarget;
let auth: TestAuth;
let admin: TestUser;
const base = "http://dashboard.test";
type Checks = Record<string, { status: string; summary: string; latencyMs?: number | null }>;

before(async () => {
  target = await startGatewayTarget();
  auth = await startTestAuth();
  admin = await auth.user("MENTOR");
});
beforeEach(() => {
  useGatewayForApp(target); auth.apply();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("610-scouting.health-cache")]; // every test checks afresh
  target.fake!.unavailable = false; target.fake!.state = "Online"; auth.store.unavailable = false;
});
after(async () => { await auth.stop(); await target.stop(); });

async function checks(): Promise<{ overall: string; checks: Checks; server: Record<string, unknown>; metrics: { errors: Array<{ source: string; message: string }> } }> {
  const response = await overview.GET(asUser(admin, `${base}/api/admin/overview`));
  assert.equal(response.status, 200);
  return await response.json() as never;
}

test("healthy: Sync Gateway, Couchbase, and the account store answer and are reported with latency", async () => {
  resetMetrics();
  const result = await checks();
  assert.equal(result.checks.syncGateway.status, "ok");
  assert.match(result.checks.syncGateway.summary, /Sync Gateway\/3\.2\.1\(fake\)/, "the version comes from Sync Gateway itself");
  assert.equal(typeof result.checks.syncGateway.latencyMs, "number");
  assert.equal(result.checks.couchbase.status, "ok");
  assert.equal(result.checks.accountStore.status, "ok");
  assert.equal(result.checks.auth.status, "ok");
  assert.match(result.checks.auth.summary, /TEST provider endpoints/, "the test-only provider override is called out, so it can't go unnoticed in production");
  assert.equal(result.checks.realtime.status, "idle", "no clients: nothing measured, so not claimed healthy");
  assert.equal(result.overall, "ok");
  for (const key of ["version", "commit", "environment", "uptimeMs", "serverTime", "nodeVersion"]) assert.ok(key in result.server, key);
});

test("Sync Gateway down: reported down, Couchbase unknown, overall down", async () => {
  target.fake!.unavailable = true;
  const result = await checks();
  assert.equal(result.checks.syncGateway.status, "degraded", "the server answers, but only with errors");
  assert.equal(result.checks.couchbase.status, "unknown");
  await target.fake!.stop();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("610-scouting.health-cache")];
  try {
    const unreachable = await checks();
    assert.equal(unreachable.checks.syncGateway.status, "down");
    assert.equal(unreachable.overall, "down");
  } finally {
    await target.fake!.start(Number(new URL(target.origin).port));
  }
});

test("bucket offline: Sync Gateway up but its database not Online shows Couchbase degraded", async () => {
  target.fake!.state = "Offline";
  const result = await checks();
  assert.equal(result.checks.syncGateway.status, "ok");
  assert.equal(result.checks.couchbase.status, "degraded");
  assert.match(result.checks.couchbase.summary, /Offline/);
});

test("account store down: shown as down; once cached sessions lapse, the overview answers 503 rather than a false 'healthy'", async () => {
  await checks(); // the admin's session is now in the 10 s cache
  auth.store.unavailable = true;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("610-scouting.health-cache")];
  const cached = await checks();
  assert.equal(cached.checks.accountStore.status, "down");
  assert.equal(cached.checks.auth.status, "down");
  assert.equal(cached.overall, "down");
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("610-scouting.session-cache")];
  const response = await overview.GET(asUser(admin, `${base}/api/admin/overview`));
  assert.equal(response.status, 503);
});

test("errors: server errors appear in the overview and flip the API check", async () => {
  resetMetrics();
  recordError("next:route", new Error("boom in handler"), "/api/something");
  const result = await checks();
  assert.equal(result.checks.api.status, "degraded");
  assert.equal(result.metrics.errors[0].message, "boom in handler");
});

test("unconfigured Couchbase is reported as unconfigured, not healthy", async () => {
  const saved = process.env.COUCHBASE_PASSWORD;
  delete process.env.COUCHBASE_PASSWORD;
  try {
    const result = await checks();
    assert.equal(result.checks.syncGateway.status, "unconfigured");
    assert.notEqual(result.overall, "ok");
  } finally { process.env.COUCHBASE_PASSWORD = saved; }
});

test("diagnostics: a real write/read/delete round trip, which fails when the store fails", async () => {
  const run = async () => (await diagnostics.POST(asUser(admin, `${base}/api/admin/diagnostics`, { method: "POST" }))).json() as Promise<{ checks: Checks }>;
  const ok = await run();
  assert.equal(ok.checks.persistence.status, "ok");
  assert.equal([...auth.store.docs.entries()].some(([id, doc]) => id.startsWith("diag_") && !doc.deleted), false, "the test document is cleaned up");
  // Writes fail but reads succeed: sessions still validate, and persistence is reported down.
  auth.store.rejectWrites = /^diag_/;
  try {
    const failing = await (await diagnostics.POST(asUser(admin, `${base}/api/admin/diagnostics`, { method: "POST" }))).json() as { checks: Checks };
    assert.equal(failing.checks.persistence.status, "down");
  } finally { auth.store.rejectWrites = null; }
});

test("health checks are cached for 10 s so many admin tabs do not multiply the load", async () => {
  const before = target.fake!.requests.length;
  await checks(); await checks(); await checks();
  const probes = target.fake!.requests.slice(before).filter((url) => url.pathname === "/" || url.pathname === `/${target.database}/`);
  assert.equal(probes.length, 2, "one root and one database request for three overview loads");
});
