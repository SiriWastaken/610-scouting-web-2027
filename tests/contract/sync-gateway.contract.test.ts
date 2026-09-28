// The Sync Gateway behaviour this app depends on, checked against whichever
// gateway TEST_SG_TARGET selects: the in-memory fake (default), or a real
// Couchbase Server + Sync Gateway (`npm run test:real`, required in CI).
// If the fake ever drifts from the real server, this file fails in CI.
//
// Everything here goes through public REST calls and the app's own code; no
// fake-only hooks are used.
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { startCouchbaseLongPoll } from "../../lib/couchbase-longpoll.ts";
import { parseChangesFrame, type RealtimeFrame } from "../../lib/realtime-protocol.ts";
import { fetchTeamAggregatesSnapshot, queryDashboardDocuments } from "../../services/couchbase.ts";
import { useGatewayForApp } from "../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { startRealtimeHarness, type RealtimeHarness } from "../helpers/realtime-harness.ts";
import { waitFor } from "../helpers/wait.ts";

let target: GatewayTarget;
let realtime: RealtimeHarness;
// Team numbers unique to this run, so a persistent test database never mixes runs.
const base = 10_000 + (Number(process.env.TEST_SEED ?? 0) % 80_000);
let nextTeam = base;
const team = () => nextTeam++;

before(async () => {
  target = await startGatewayTarget();
  useGatewayForApp(target);
  realtime = await startRealtimeHarness(target);
  mock.timers.enable({ apis: ["Date"], now: 0 });
});
beforeEach(() => { mock.timers.tick(21_000); }); // fresh server snapshot per test
after(async () => { mock.timers.reset(); await realtime.stop(); await target.stop(); });

const generation = (rev?: string) => Number(rev?.split("-")[0]);
async function changesSince(since: string, params: Record<string, string> = {}) {
  const url = new URL(target.changesUrl);
  url.searchParams.set("since", since);
  url.searchParams.set("include_docs", "true");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: target.authorization } });
  return { status: response.status, body: await response.json() as { results: Array<Record<string, unknown>>; last_seq: unknown } };
}

test(`contract[${process.env.TEST_SG_TARGET ?? "fake"}]: requests without valid credentials are rejected`, async () => {
  assert.equal((await fetch(`${target.changesUrl}?since=0`)).status, 401);
  const wrong = `Basic ${Buffer.from(`${target.username}:wrong-password`).toString("base64")}`;
  assert.equal((await fetch(`${target.changesUrl}?since=0`, { headers: { Authorization: wrong } })).status, 401);
});

test("contract: create, read back, update with the current revision, and generations increase", async () => {
  const id = `scouting_${team()}_1`;
  const body = { type: "scouting_data", data: { start: { match: 1, alliance: "red" }, teleop: { fuelscored: 12.5 }, name: "Équipe 🤖" } };
  const created = await target.write(id, body);
  assert.equal(created.status, 201);
  assert.equal(generation(created.rev), 1);
  const read = await target.read(id);
  assert.deepEqual({ type: read?.type, data: read?.data }, body, "serialisation round-trips exactly (unicode, floats, nesting)");
  assert.equal(read?._rev, created.rev);
  const updated = await target.write(id, { ...body, data: { ...body.data, teleop: { fuelscored: 13 } } }, created.rev);
  assert.equal(updated.status, 201);
  assert.equal(generation(updated.rev), 2);
  assert.deepEqual((await target.read(id))?.data, { ...body.data, teleop: { fuelscored: 13 } });
});

test("contract: conflicting and stale writes are refused with 409 and change nothing", async () => {
  const id = `pit_${team()}`;
  const first = await target.write(id, { type: "pit", data: { teamName: "First" } });
  assert.equal((await target.write(id, { type: "pit", data: { teamName: "No rev" } })).status, 409, "an existing document needs a revision");
  const second = await target.write(id, { type: "pit", data: { teamName: "Second" } }, first.rev);
  assert.equal((await target.write(id, { type: "pit", data: { teamName: "Stale" } }, first.rev)).status, 409, "a superseded revision is refused");
  assert.equal((await target.read(id))?._rev, second.rev);
  assert.deepEqual((await target.read(id))?.data, { teamName: "Second" });
});

test("contract: simultaneous creates of one document id produce exactly one winner", async () => {
  const id = `scouting_${team()}_1`;
  const results = await Promise.all(Array.from({ length: 8 }, (_, device) => target.write(id, { type: "scouting_data", data: { device } })));
  assert.equal(results.filter((result) => result.status === 201).length, 1, results.map((result) => result.status).join(","));
  assert.ok(results.every((result) => result.status === 201 || result.status === 409));
});

test("contract: delete, read after delete, and recreate", async () => {
  const id = `report_${team()}_Q1`;
  const created = await target.write(id, { type: "report_card", data: { cardType: "Yellow" } });
  assert.equal((await target.remove(id, "1-0000000000000000")).status, 409, "deleting with the wrong revision fails");
  const removed = await target.remove(id, created.rev!);
  assert.equal(removed.status, 200);
  assert.ok(generation(removed.rev) > generation(created.rev));
  assert.equal(await target.read(id), null);
  const recreated = await target.write(id, { type: "report_card", data: { cardType: "Red" } });
  assert.equal(recreated.status, 201);
  assert.ok(generation(recreated.rev) > generation(removed.rev), "a recreated document continues the revision history");
});

test("contract: malformed document bodies are rejected", async () => {
  const id = `pit_${team()}`;
  for (const body of ["{not json", "[1,2,3]", "\"string\""]) {
    const response = await fetch(`${target.origin}/${target.database}/${id}`, { method: "PUT", headers: { Authorization: target.authorization, "Content-Type": "application/json" }, body });
    assert.equal(response.status, 400, body);
  }
  assert.equal(await target.read(id), null, "nothing was stored");
});

test("contract: the changes feed returns only newer changes, one row per document, with revisions and bodies", async () => {
  const since = await target.lastSeq();
  const t = team();
  const createdRev = await target.upsert(`aggregate_${t}`, { type: "aggregate_data", team: t, data: { standing: 1 } });
  const updatedRev = await target.upsert(`aggregate_${t}`, { type: "aggregate_data", team: t, data: { standing: 2 } });
  const pitRev = await target.upsert(`pit_${t}`, { type: "pit", data: { teamName: "Row test" } });
  const deletedRev = await target.destroy(`pit_${t}`);
  const { status, body } = await changesSince(since);
  assert.equal(status, 200);
  const rows = body.results.filter((row) => String(row.id).endsWith(`_${t}`));
  assert.deepEqual(rows.map((row) => row.id), [`aggregate_${t}`, `pit_${t}`], "only the latest revision of each document, in sequence order");
  assert.ok(createdRev !== updatedRev && pitRev !== deletedRev);
  assert.equal((rows[0].changes as Array<{ rev: string }>)[0].rev, updatedRev);
  assert.equal((rows[0].doc as { _rev: string })._rev, updatedRev);
  assert.equal(rows[1].deleted, true);
  assert.equal((rows[1].changes as Array<{ rev: string }>)[0].rev, deletedRev);
  // The app's parser turns real rows into the frames the dashboard expects.
  const frames = parseChangesFrame(rows);
  assert.deepEqual(frames.map((frame) => frame.type === "change" ? [frame.id, frame.deleted, frame.rev] : frame.type), [[`aggregate_${t}`, false, updatedRev], [`pit_${t}`, true, deletedRev]]);
  // Resuming from last_seq returns nothing already seen.
  const resumed = await changesSince(String(body.last_seq));
  assert.equal(resumed.body.results.filter((row) => String(row.id).endsWith(`_${t}`)).length, 0);
});

test("contract: `limit` pages a backlog and `last_seq` resumes exactly where the page ended", async () => {
  const since = await target.lastSeq();
  const t = team();
  for (let match = 1; match <= 7; match += 1) await target.upsert(`scouting_${t}_${match}`, { type: "scouting_data", data: {} });
  const seen: string[] = [];
  let cursor = since;
  for (let page = 0; page < 10; page += 1) {
    const { body } = await changesSince(cursor, { limit: "3" });
    assert.ok(body.results.length <= 3);
    seen.push(...body.results.map((row) => String(row.id)).filter((id) => id.startsWith(`scouting_${t}_`)));
    if (body.results.length === 0) break;
    cursor = String(body.last_seq);
  }
  assert.deepEqual(seen, Array.from({ length: 7 }, (_, index) => `scouting_${t}_${index + 1}`));
});

test("contract: an unusable `since` value is a 400 (the app turns this into a resync)", async () => {
  const response = await fetch(`${target.changesUrl}?since=${encodeURIComponent("not-a-sequence")}`, { headers: { Authorization: target.authorization } });
  assert.equal(response.status, 400);
});

test("contract: a long-poll waits for the next change and returns it", async () => {
  const since = await target.lastSeq();
  const t = team();
  const started = performance.now();
  const waiting = changesSince(since, { feed: "longpoll", timeout: "20000" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await target.upsert(`pit_${t}`, { type: "pit", data: { teamName: "Wakes the poll" } });
  const { body } = await waiting;
  assert.ok(performance.now() - started >= 250, "the request waited for a change");
  assert.ok(body.results.some((row) => row.id === `pit_${t}`));
});

test("contract: the app's long-poll loop relays create, update, and delete in order", async () => {
  const since = await target.lastSeq();
  const t = team();
  const frames: RealtimeFrame[] = [];
  let failure: Error | undefined;
  let ready = false;
  const stop = startCouchbaseLongPoll({ url: target.changesUrl, authorization: target.authorization }, since, (frame) => frames.push(frame), () => { ready = true; }, (error) => { failure = error; });
  try {
    await waitFor(() => ready || failure, "feed ready", 20_000);
    assert.equal(failure, undefined);
    const id = `scouting_${t}_1`;
    const revs = [await target.upsert(id, { type: "scouting_data", data: { start: { match: 1 } } })];
    await waitFor(() => frames.some((frame) => frame.type === "change" && frame.rev === revs[0]), "create relayed", 20_000);
    revs.push(await target.upsert(id, { type: "scouting_data", data: { start: { match: 1 }, teleop: { fuelscored: 4 } } }));
    await waitFor(() => frames.some((frame) => frame.type === "change" && frame.rev === revs[1]), "update relayed", 20_000);
    revs.push((await target.destroy(id))!);
    await waitFor(() => frames.some((frame) => frame.type === "change" && frame.rev === revs[2] && frame.deleted), "delete relayed", 20_000);
    const ours = frames.filter((frame) => frame.type === "change" && frame.id === id).map((frame) => frame.type === "change" && frame.rev);
    assert.deepEqual(ours, revs);
  } finally { stop(); }
});

test("contract: the server snapshot reads real data and its cursor leaves no gap before the live feed", async () => {
  const t = team();
  await target.upsert(`aggregate_${t}`, { type: "aggregate_data", team: t, data: { standing: 3, matchesPlayed: 4, autoPPG: 7.5, teleopFuelaccuracy: 66.6 } });
  await target.upsert(`pit_${t}`, { type: "pit", team: t, data: { teamName: "Snapshot Team", notes: "private" } });
  await target.upsert(`scouting_${t}_1`, { type: "scouting_data", data: { start: { match: 1, scoutName: "private" } } });
  mock.timers.tick(21_000);
  const snapshot = await fetchTeamAggregatesSnapshot();
  const row = snapshot.teams.find((candidate) => candidate.team === t);
  assert.deepEqual(row && [row.name, row.rank, row.matches, row.autoPpg, row.fuelAccuracy], ["Snapshot Team", 3, 4, 7.5, 67]);
  const matches = await queryDashboardDocuments("matches", t);
  assert.deepEqual(matches.map((document) => document._default.data), [{ start: { match: 1 } }], "private fields are stripped from real documents");

  const client = await realtime.connected(snapshot.lastSeq);
  const rev = await target.upsert(`scouting_${t}_2`, { type: "scouting_data", data: { start: { match: 2 } } });
  await waitFor(() => client.store.get(`scouting_${t}_2`)?.rev === rev, "change after the snapshot arrives live", 20_000);
  assert.equal(client.store.get(`scouting_${t}_1`), undefined, "nothing before the snapshot is replayed");
  client.disconnect();
});

test("contract: a client that was offline replays every missed change from its cursor", async () => {
  const t = team();
  const client = await realtime.connected(await target.lastSeq());
  await target.upsert(`scouting_${t}_1`, { type: "scouting_data", data: {} });
  await waitFor(() => client.store.get(`scouting_${t}_1`), "first change", 20_000);
  realtime.setReachable(false);
  realtime.dropConnections();
  await waitFor(() => client.getStatus() === "reconnecting", "offline");
  const missed = [await target.upsert(`scouting_${t}_2`, { type: "scouting_data", data: {} }), await target.upsert(`scouting_${t}_1`, { type: "scouting_data", data: { teleop: { fuelscored: 1 } } })];
  const deleted = await target.destroy(`scouting_${t}_2`);
  realtime.setReachable(true);
  await waitFor(() => client.store.get(`scouting_${t}_1`)?.rev === missed[1] && client.store.get(`scouting_${t}_2`)?.rev === deleted && client.store.get(`scouting_${t}_2`)?.deleted, "missed changes replayed", 20_000);
  client.disconnect();
});
