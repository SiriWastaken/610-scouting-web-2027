// What happens when Couchbase/Sync Gateway, the network, or the realtime server
// misbehaves: failures must be predictable, bounded in time, never corrupt
// data, and recover without a page reload.
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { GET } from "../../../app/api/dashboard-documents/route.ts";
import { fetchTeamAggregatesSnapshot } from "../../../services/couchbase.ts";
import { FAKE_DATABASE, FAKE_PASSWORD, FAKE_USERNAME, FakeSyncGateway } from "../../helpers/fake-sync-gateway.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { startRealtimeHarness, type RealtimeHarness } from "../../helpers/realtime-harness.ts";
import { sleep, waitFor } from "../../helpers/wait.ts";
import { asUser } from "../../helpers/auth.ts";

let target: GatewayTarget;
let gateway: FakeSyncGateway;
let realtime: RealtimeHarness;

before(async () => {
  target = await startGatewayTarget();
  assert.ok(target.fake, "fault injection needs the fake gateway");
  gateway = target.fake;
  gateway.put("aggregate_610", { type: "aggregate_data", team: 610, data: { standing: 1, matchesPlayed: 3 } });
  realtime = await startRealtimeHarness(target);
  mock.timers.enable({ apis: ["Date"], now: 0 });
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
});
beforeEach(() => {
  Object.assign(process.env, target.appEnv(), { COUCHBASE_REQUEST_TIMEOUT_MS: "750" });
  gateway.clearFaults();
  mock.timers.tick(21_000); // expire the server snapshot cache
});
after(async () => { mock.timers.reset(); await realtime.stop(); await target.stop(); });

const teams = async () => (await fetchTeamAggregatesSnapshot()).teams.map((team) => team.team);
const apiStatus = async () => (await GET(asUser(realtime.member, "http://dashboard.test/api/dashboard-documents?kind=matches&team=610"))).status;

for (const [label, fault] of [
  ["HTTP 500", { kind: "status", status: 500 }],
  ["HTTP 503", { kind: "status", status: 503 }],
  ["a non-JSON body", { kind: "garbage" }],
  ["a dropped connection", { kind: "reset" }],
] as const) {
  test(`database failure (${label}): pages get an empty snapshot, the API still answers, and the next request recovers`, async () => {
    gateway.fault(fault, 2);
    assert.deepEqual(await fetchTeamAggregatesSnapshot(), { teams: [], lastSeq: 0, names: {} });
    assert.equal(await apiStatus(), 200);
    assert.deepEqual(await teams(), [610], "failures are not cached");
  });
}

test("database timeout: a gateway that never answers cannot hang page rendering", async () => {
  gateway.fault({ kind: "hang" });
  const realStart = performance.now();
  assert.deepEqual((await fetchTeamAggregatesSnapshot()).teams, []);
  const elapsed = performance.now() - realStart;
  assert.ok(elapsed >= 700 && elapsed < 5000, `gave up after ${elapsed.toFixed(0)} ms (limit 750 ms)`);
  assert.deepEqual(await teams(), [610], "the next request succeeds");
});

test("database unavailable: nothing listening on the configured port", async () => {
  process.env.COUCHBASE_SYNC_GATEWAY_URL = "http://127.0.0.1:9";
  assert.deepEqual((await fetchTeamAggregatesSnapshot()).teams, []);
  assert.equal(await apiStatus(), 200);
});

test("invalid credentials: rejected upstream, reported as an empty dashboard rather than a crash", async () => {
  process.env.COUCHBASE_PASSWORD = "wrong";
  assert.deepEqual((await fetchTeamAggregatesSnapshot()).teams, []);
  process.env.COUCHBASE_PASSWORD = FAKE_PASSWORD;
  assert.deepEqual(await teams(), [610]);
});

test("configuration: a ws:// Sync Gateway URL reaches the same server for snapshots and the realtime feed", async () => {
  Object.assign(process.env, { COUCHBASE_SYNC_GATEWAY_URL: gateway.origin.replace("http:", "ws:"), COUCHBASE_DATABASE: FAKE_DATABASE, COUCHBASE_USERNAME: FAKE_USERNAME });
  assert.deepEqual(await teams(), [610]);
});

test("realtime: a Sync Gateway outage mid-stream is recovered and every change made during it is delivered", async () => {
  const client = await realtime.connected(await target.lastSeq());
  gateway.fail(503, 3);
  gateway.put("pit_1", { type: "pit", data: { teamName: "wakes the long-poll" } });
  await waitFor(() => client.getStatus() === "reconnecting", "client noticed the outage");
  const during = ["scouting_42_1", "scouting_42_2", "scouting_42_3"].map((id) => [id, gateway.put(id, { type: "scouting_data", data: { start: { match: 1 } } })]);
  await waitFor(() => client.getStatus() === "connected", "recovered", 10_000);
  await waitFor(() => during.every(([id, rev]) => client.store.get(id)?.rev === rev), "changes made during the outage");
  client.disconnect();
});

test("realtime: a server restart loses no updates and creates no duplicates", async () => {
  const clients = await Promise.all([1, 2, 3].map(async () => realtime.connected(await target.lastSeq())));
  const seen = clients.map((client) => { let count = 0; client.subscribe(() => { count += 1; }); return () => count; });
  gateway.put("scouting_43_1", { type: "scouting_data", data: { start: { match: 1 } } });
  await waitFor(() => clients.every((client) => client.store.get("scouting_43_1")), "before restart");

  const restarting = realtime.restart();
  const writes = [gateway.put("scouting_43_2", { type: "scouting_data", data: {} }), gateway.put("scouting_43_1", { type: "scouting_data", data: { start: { match: 1 }, teleop: { fuelscored: 5 } } })];
  await restarting;
  await waitFor(() => clients.every((client) => client.store.get("scouting_43_2")?.rev === writes[0] && client.store.get("scouting_43_1")?.rev === writes[1]), "caught up after restart", 10_000);
  await sleep(200);
  assert.deepEqual(seen.map((count) => count()), [3, 3, 3], "exactly three new pieces of information per client");
  clients.forEach((client) => client.disconnect());
});

test("realtime: a WebSocket drop during writes never changes persisted data, and clients converge on it", async () => {
  const client = await realtime.connected(await target.lastSeq());
  const writes = new Map<string, string>();
  for (let index = 0; index < 20; index += 1) {
    const id = `scouting_44_${index}`;
    writes.set(id, await target.upsert(id, { type: "scouting_data", data: { start: { match: index } } }));
    if (index % 5 === 0) realtime.dropConnections();
  }
  for (const [id, rev] of writes) assert.equal((await target.read(id))?._rev, rev, `${id} persisted exactly as written`);
  await waitFor(() => [...writes].every(([id, rev]) => client.store.get(id)?.rev === rev), "client converged on persisted data", 10_000);
  client.disconnect();
});

test("failed writes are not persisted and never reach connected clients", async () => {
  const client = await realtime.connected(await target.lastSeq());
  const rev = await target.upsert("pit_45", { type: "pit", data: { teamName: "Original" } });
  await waitFor(() => client.store.get("pit_45")?.rev === rev, "original delivered");
  const version = client.getVersion();

  assert.equal((await target.write("pit_45", { type: "pit", data: { teamName: "No revision" } })).status, 409);
  assert.equal((await target.write("pit_45", { type: "pit", data: { teamName: "Stale" } }, "1-00000000")).status, 409);
  const response = await fetch(`${target.origin}/${FAKE_DATABASE}/pit_45?rev=${rev}`, { method: "PUT", headers: { Authorization: target.authorization }, body: "{not json" });
  assert.equal(response.status, 400);

  assert.equal(((await target.read("pit_45"))?.data as { teamName: string }).teamName, "Original");
  gateway.put("pit_46", { type: "pit", data: {} }); // marker
  await waitFor(() => client.store.get("pit_46"), "marker");
  assert.equal(client.getVersion(), version + 1, "only the marker was new");
  client.disconnect();
});

test("malformed documents already in the database do not break the dashboard", async () => {
  gateway.put("aggregate_46", { type: "aggregate_data", team: 46, data: "not an object" });
  gateway.put("aggregate_47", { type: "aggregate_data", team: 47, data: [1, 2, 3] });
  gateway.put("scouting_610_77", { type: "scouting_data", data: null });
  gateway.put("pit_48", { type: "pit", data: { teamName: { nested: true } } });
  mock.timers.tick(21_000);
  assert.deepEqual(await teams(), [610]);
  const response = await GET(asUser(realtime.member, "http://dashboard.test/api/dashboard-documents?kind=matches&team=610"));
  assert.equal(response.status, 200);
});
