// Load at (and somewhat beyond) a real event: many dashboard tabs open at
// once, bursts of submissions after each match cycle, and big datasets. Time
// limits are generous smoke bounds meant to catch pathological slowdowns
// (quadratic merges, per-event reconnects), not to benchmark the machine.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { RealtimeClient } from "../../lib/realtime-client.ts";
import { mergeAggregates } from "../../lib/normalize-aggregate.ts";
import { DocumentStore } from "../../lib/realtime-store.ts";
import { getActiveRealtimeConnections } from "../../lib/realtime-bridge.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { startRealtimeHarness, type RealtimeHarness } from "../helpers/realtime-harness.ts";
import { mapLimit, seededRandom, waitFor } from "../helpers/wait.ts";

let target: GatewayTarget;
let realtime: RealtimeHarness;
before(async () => { target = await startGatewayTarget(); realtime = await startRealtimeHarness(target); });
after(async () => { await realtime.stop(); await target.stop(); });

test("stress: 120 connected dashboards all receive a 300-submission burst exactly once", async () => {
  const since = await target.lastSeq();
  const clients: RealtimeClient[] = [];
  for (let batch = 0; batch < 6; batch += 1) clients.push(...await Promise.all(Array.from({ length: 20 }, () => realtime.connected(since))));
  assert.equal(getActiveRealtimeConnections(), 120);
  const counts = clients.map((client) => { let count = 0; client.subscribe(() => { count += 1; }); return () => count; });
  const started = performance.now();
  // Six scouts per match, 50 matches, written as fast as the gateway accepts them (six scouts submitting at once).
  const ids = Array.from({ length: 300 }, (_, index) => `scouting_${1000 + (index % 6)}_${Math.floor(index / 6) + 1}`);
  await mapLimit(ids, 6, (id) => target.upsert(id, { type: "scouting_data", data: { start: { match: Number(id.split("_")[2]) } } }));
  await waitFor(() => clients.every((client) => ids.every((id) => client.store.get(id))), "every client has every submission", 60_000);
  const elapsed = performance.now() - started;
  assert.ok(counts.every((count) => count() === 300), `notifications per client: ${[...new Set(counts.map((count) => count()))].join(",")}`);
  assert.ok(clients.every((client) => client.getStatus() === "connected"), "no client was dropped under load");
  assert.ok(elapsed < 45_000, `burst delivered in ${elapsed.toFixed(0)} ms`);
  clients.forEach((client) => client.disconnect());
  await waitFor(() => getActiveRealtimeConnections() === 0, "connections released", 10_000);
});

test("stress: rapid successive edits to one record converge on the final revision everywhere", async () => {
  const since = await target.lastSeq();
  const clients = await Promise.all(Array.from({ length: 10 }, () => realtime.connected(since)));
  let rev = "";
  for (let edit = 0; edit < 150; edit += 1) rev = await target.upsert("aggregate_1001", { type: "aggregate_data", team: 1001, data: { standing: 1, matchesPlayed: edit } });
  await waitFor(() => clients.every((client) => client.store.get("aggregate_1001")?.rev === rev), "final revision everywhere", 30_000);
  for (const client of clients) assert.equal(mergeAggregates([], client.store).find((team) => team.team === 1001)?.matches, 149);
  clients.forEach((client) => client.disconnect());
});

test("stress: merging a championship-sized feed (400 teams, 24,000 records) stays fast", () => {
  const random = seededRandom(Number(process.env.TEST_SEED ?? 7));
  const store = new DocumentStore();
  let seq = 0;
  for (let team = 1; team <= 400; team += 1) {
    for (let revision = 1; revision <= 3; revision += 1) {
      store.apply({ type: "change", id: `aggregate_${team}`, rev: `${revision}-a`, seq: ++seq, deleted: false, doc: { _id: `aggregate_${team}`, type: "aggregate_data", team, data: { standing: Math.ceil(random() * 400), matchesPlayed: revision * 4 } } });
    }
    store.apply({ type: "change", id: `pit_${team}`, rev: "1-a", seq: ++seq, deleted: false, doc: { _id: `pit_${team}`, type: "pit", data: { teamName: `Team ${team} name` } } });
    for (let match = 1; match <= 55; match += 1) store.apply({ type: "change", id: `scouting_${team}_${match}`, rev: "1-a", seq: ++seq, deleted: false, doc: { _id: `scouting_${team}_${match}`, data: {} } });
  }
  const started = performance.now();
  let teams = mergeAggregates([], store);
  for (let render = 0; render < 20; render += 1) teams = mergeAggregates(teams, store);
  const perMerge = (performance.now() - started) / 21;
  assert.equal(teams.length, 400);
  assert.ok(teams.every((team) => team.matches === 12 && team.name === `Team ${team.team} name`));
  for (let index = 1; index < teams.length; index += 1) {
    const [previous, current] = [teams[index - 1], teams[index]];
    assert.ok(previous.rank < current.rank || (previous.rank === current.rank && previous.team < current.team), "sorted by rank, then team");
  }
  assert.ok(perMerge < 250, `one merge (re-render) took ${perMerge.toFixed(1)} ms`);
  const mergeStarted = performance.now();
  const rest = Array.from({ length: 2000 }, (_, index) => ({ _id: `scouting_${(index % 400) + 1}_${(index % 55) + 1}`, _rev: "1-a" }));
  store.merge(rest, (id) => id.startsWith("scouting_1_"));
  assert.ok(performance.now() - mergeStarted < 2000, "REST reconciliation of a large team history is fast");
});
