// GET /api/dashboard-documents, called the way the browser calls it, backed by
// the fake Sync Gateway over real HTTP. Assertions check the response and the
// persisted state behind it.
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { GET } from "../../../app/api/dashboard-documents/route.ts";
import { eventDocuments, expectedMatchIds610, expectedReportIds610, privateStrings } from "../../fixtures/event-dataset.ts";
import { seedDocuments, useGatewayForApp } from "../../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { asUser, startTestAuth, type TestAuth, type TestUser } from "../../helpers/auth.ts";

let target: GatewayTarget;
let auth: TestAuth;
let member: TestUser;
before(async () => {
  target = await startGatewayTarget();
  // The route requires a signed-in member; its authorization is covered in tests/security/authorization-matrix.test.ts.
  auth = await startTestAuth();
  await seedDocuments(target, eventDocuments);
  useGatewayForApp(target);
  // The server caches its Couchbase snapshot for 20 s. Control the clock so each
  // test starts from a fresh snapshot and cache behaviour can be tested exactly.
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-03-02T12:00:00Z") });
  // Signed in on the mocked clock, so the session is fresh at the time the tests run.
  member = await auth.user("MEMBER");
});
beforeEach(() => { mock.timers.tick(21_000); });
after(async () => { mock.timers.reset(); await auth.stop(); await target.stop(); });

type Documents = Array<{ _default: Record<string, unknown> }>;
async function get(query: string) {
  const response = await GET(asUser(member, `http://dashboard.test/api/dashboard-documents?${query}`));
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) as { documents?: Documents; error?: string } };
}
const ids = (documents?: Documents) => (documents ?? []).map((document) => String(document._default._id)).sort();

test("api: matches for a team are exactly that team's valid scouting documents", async () => {
  const { status, body, headers } = await get("kind=matches&team=610");
  assert.equal(status, 200);
  assert.deepEqual(ids(body.documents), expectedMatchIds610, "no prefix collision with 6100, no malformed ids, no other document types");
  assert.equal(headers.get("cache-control"), "private, no-store, max-age=0");
});

test("api: response schema: every document is wrapped, carries its id and revision, and nothing else leaks", async () => {
  const { body, text } = await get("kind=matches&team=610");
  for (const { _default: document } of body.documents!) {
    assert.deepEqual(Object.keys(document).filter((key) => !["_id", "_rev", "type", "team", "teamNumber", "timestamp", "data"].includes(key)), []);
    assert.match(String(document._rev), /^1-/);
    assert.equal(typeof document.data, "object");
  }
  for (const secret of privateStrings) assert.equal(text.includes(secret), false, `"${secret}" must not be served`);
});

test("api: pit and report documents", async () => {
  const pit = await get("kind=pit&team=610");
  assert.deepEqual(pit.body.documents, [{ _default: { _id: "pit_610", _rev: pit.body.documents![0]._default._rev, type: "pit", team: 610, data: { teamName: "Crescent Coyotes", drivetrainType: "swerve" } } }]);
  assert.deepEqual(ids((await get("kind=reports&team=610")).body.documents), expectedReportIds610);
});

test("api: a team with no documents returns an empty list, not an error", async () => {
  const { status, body } = await get("kind=matches&team=4");
  assert.equal(status, 200);
  assert.deepEqual(body, { documents: [] });
});

test("api: malformed or missing parameters are rejected with 400 and a JSON error", async () => {
  for (const query of ["", "kind=matches", "team=610", "kind=bogus&team=610", "kind=MATCHES&team=610", "kind=matches&team=0", "kind=matches&team=-610", "kind=matches&team=61.5", "kind=matches&team=100000", "kind=matches&team=abc", "kind=matches&team=", "kind=matches&team=Infinity", "kind=matches&team=9007199254740993", "kind=__proto__&team=610", "kind=constructor&team=610"]) {
    const { status, body } = await get(query);
    assert.equal(status, 400, query);
    assert.deepEqual(body, { error: "Invalid dashboard document query" }, query);
  }
});

// Tests that write use their own team numbers (612, 613) so they never change what other tests read.
test("api: a new submission is persisted, then served once the 20 s snapshot cache expires", async () => {
  await target.upsert("scouting_612_1", { type: "scouting_data", team: 612, data: { start: { match: 1 } } });
  mock.timers.tick(21_000);
  assert.deepEqual(ids((await get("kind=matches&team=612")).body.documents), ["scouting_612_1"]);
  const rev = await target.upsert("scouting_612_11", { type: "scouting_data", team: 612, data: { start: { match: 11 }, teleop: { fuelscored: 9 } } });
  assert.equal((await target.read("scouting_612_11"))?._rev, rev, "persisted in the gateway");

  mock.timers.tick(19_000);
  assert.deepEqual(ids((await get("kind=matches&team=612")).body.documents), ["scouting_612_1"], "within the cache window the snapshot is reused (realtime covers the gap)");
  mock.timers.tick(2_000);
  const fresh = await get("kind=matches&team=612");
  assert.deepEqual(ids(fresh.body.documents), ["scouting_612_1", "scouting_612_11"]);
  assert.equal(fresh.body.documents!.find((document) => document._default._id === "scouting_612_11")?._default._rev, rev);
});

test("api: updates and deletes in the database are reflected after the cache window", async () => {
  const rev = await target.upsert("scouting_613_12", { type: "scouting_data", team: 613, data: { start: { match: 12 }, teleop: { fuelscored: 1 } } });
  const updated = await target.write("scouting_613_12", { type: "scouting_data", team: 613, data: { start: { match: 12 }, teleop: { fuelscored: 2 } } }, rev);
  assert.equal(updated.status, 201);
  mock.timers.tick(21_000);
  const served = (await get("kind=matches&team=613")).body.documents!.find((document) => document._default._id === "scouting_613_12")!._default;
  assert.equal(served._rev, updated.rev);
  assert.deepEqual((served.data as { teleop: unknown }).teleop, { fuelscored: 2 });

  await target.destroy("scouting_613_12");
  assert.equal(await target.read("scouting_613_12"), null, "deleted in the gateway");
  mock.timers.tick(21_000);
  assert.deepEqual(ids((await get("kind=matches&team=613")).body.documents), []);
});

test("api: simultaneous requests share one upstream snapshot request", async () => {
  const fake = target.fake;
  assert.ok(fake, "this test counts upstream requests, which needs the fake");
  const before = fake.requests.length;
  const results = await Promise.all(Array.from({ length: 25 }, (_, index) => get(`kind=${["matches", "pit", "reports"][index % 3]}&team=610`)));
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(fake.requests.length - before, 1);
});

test("api: without Couchbase configuration the API answers with an empty list instead of failing or inventing data", async () => {
  const saved = process.env.COUCHBASE_PASSWORD;
  delete process.env.COUCHBASE_PASSWORD;
  try {
    const { status, body } = await get("kind=matches&team=610");
    assert.equal(status, 200);
    assert.deepEqual(body, { documents: [] });
  } finally { process.env.COUCHBASE_PASSWORD = saved; }
});
