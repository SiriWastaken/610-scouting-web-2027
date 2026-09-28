// ─────────────────────────────────────────────────────────────────────────────
// TEST TEMPLATE: copy this file to start a new test.
//
// This file is also a real test in the `unit` suite, so it can't fall out of date.
// To add a test file:
//   1. Copy this file into the folder that matches what you are testing:
//        tests/unit/<area>/          pure logic, no network (fast)
//        tests/integration/<area>/   real HTTP/WebSocket against the fake Sync Gateway
//        tests/security/             hostile input and trust boundaries
//        tests/contract/             Sync Gateway behaviour (fake AND real Couchbase)
//        tests/stress/               load and bursts
//        tests/e2e/                  the built app in a real browser
//      Name it after the behaviour, e.g. `match-sorting.test.ts`.
//   2. Add it to scripts/test-bench/manifest.mjs with a floor of at least 1
//      (the minimum number of passing tests). An unlisted file fails `npm run test:hygiene`.
//   3. Run it on its own:  node scripts/test-bench/run.mjs unit --grep="template"
//      (repro mode; exits 3 because a filtered run never counts as validation),
//      then the whole suite: npm run test:unit
//
// Rules the bench enforces (see tests/README.md):
//   - Skipped, focused, and todo tests fail the run. Delete a test or fix it; don't switch it off.
//   - Write expected values out by hand from the inputs. Never recompute them
//     with the production function you are testing.
//   - Don't mock the thing under test. Use the fake Sync Gateway (a real HTTP server)
//     and read data back to prove it was stored.
//   - Use your own team/document ids so tests never depend on each other or on order.
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { normalizeAggregateDocument } from "../lib/normalize-aggregate.ts";
import { FakeSyncGateway, FAKE_DATABASE, FAKE_PASSWORD, FAKE_USERNAME } from "./helpers/fake-sync-gateway.ts";
import { asUser, startTestAuth, type TestAuth } from "./helpers/auth.ts";

// ── Example 1: a unit test. Pure input -> output, expected value written by hand.
test("template: an aggregate document becomes a team row with hand-checked numbers", () => {
  const row = normalizeAggregateDocument({ team: 610, data: { standing: 2, matchesPlayed: 6, teleopFuelaccuracy: 74.5 } });
  assert.equal(row?.team, 610);
  assert.equal(row?.rank, 2);
  assert.equal(row?.fuelAccuracy, 75, "74.5% rounds to 75%");
});

// ── Example 2: an error path. Bad input must fail safely, never throw or invent data.
test("template: a document without a team is ignored", () => {
  assert.equal(normalizeAggregateDocument({ data: { standing: 1 } }), null);
});

// ── Example 3: an integration test. Write like a scouting device, then read it
// back through the app's real REST handler (and so through Couchbase access code).
// Protected routes need a signed-in user: startTestAuth() gives you an account
// store and sign-in provider, and auth.user(role) a real session for that role.
let gateway: FakeSyncGateway;
let auth: TestAuth;
before(async () => {
  auth = await startTestAuth();
  gateway = new FakeSyncGateway();
  await gateway.start();
  Object.assign(process.env, { COUCHBASE_SYNC_GATEWAY_URL: gateway.origin, COUCHBASE_DATABASE: FAKE_DATABASE, COUCHBASE_USERNAME: FAKE_USERNAME, COUCHBASE_PASSWORD: FAKE_PASSWORD });
});
after(async () => { await gateway.stop(); await auth.stop(); });

test("template: a submitted match is persisted and served by the API", async () => {
  gateway.put("scouting_9990_1", { type: "scouting_data", data: { start: { match: 1 }, teleop: { fuelscored: 12 } } });
  assert.equal(gateway.docs.get("scouting_9990_1")?.deleted, false, "stored in the gateway");

  const { GET } = await import("../app/api/dashboard-documents/route.ts");
  const member = await auth.user("MEMBER");
  const response = await GET(asUser(member, "http://dashboard.test/api/dashboard-documents?kind=matches&team=9990"));
  assert.equal(response.status, 200);
  const { documents } = await response.json() as { documents: Array<{ _default: { _id: string; data: { teleop: { fuelscored: number } } } }> };
  assert.equal(documents.length, 1);
  assert.equal(documents[0]._default._id, "scouting_9990_1");
  assert.equal(documents[0]._default.data.teleop.fuelscored, 12);
});
