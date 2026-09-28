// Team statistics as the pages receive them: the server snapshot built from
// Couchbase, and the same data after realtime changes are merged in the browser.
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import fc from "fast-check";
import { fetchTeamAggregatesSnapshot } from "../../../services/couchbase.ts";
import { mergeAggregates } from "../../../lib/normalize-aggregate.ts";
import { parseChangesFrame, type RealtimeChange } from "../../../lib/realtime-protocol.ts";
import { DocumentStore } from "../../../lib/realtime-store.ts";
import type { TeamAggregate } from "../../../types/scouting.ts";
import { eventDocuments, expectedTeams } from "../../fixtures/event-dataset.ts";
import { seedDocuments, useGatewayForApp } from "../../helpers/dataset.ts";
import { FakeSyncGateway, FAKE_AUTH, FAKE_DATABASE, FAKE_PASSWORD, FAKE_USERNAME } from "../../helpers/fake-sync-gateway.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { seededRandom } from "../../helpers/wait.ts";

let target: GatewayTarget;
before(async () => { target = await startGatewayTarget(); useGatewayForApp(target); mock.timers.enable({ apis: ["Date"], now: 0 }); });
beforeEach(() => { mock.timers.tick(21_000); });
after(async () => { mock.timers.reset(); await target.stop(); });

const view = (teams: TeamAggregate[]) => teams.map(({ team, name, rank, matches, autoPpg, teleopPpg, endgamePpg, fuelPerMatch, fuelAccuracy, defenseRating, driverSkill, breakRate }) =>
  ({ team, name, rank, matches, autoPpg, teleopPpg, endgamePpg, fuelPerMatch, fuelAccuracy, defenseRating, driverSkill, breakRate }));

test("statistics: the event dataset produces exactly the hand-computed team table", async () => {
  await seedDocuments(target, eventDocuments);
  mock.timers.tick(21_000);
  const { teams, lastSeq } = await fetchTeamAggregatesSnapshot();
  assert.deepEqual(view(teams), expectedTeams);
  assert.equal(String(lastSeq), await target.lastSeq(), "the snapshot cursor is the end of the feed it was built from");
  for (const team of teams) assert.equal(new Set(teams.map((row) => row.team)).size, teams.length, `team ${team.team} appears once`);
  for (const team of teams) assert.equal(JSON.stringify(team.rawData).includes("private"), false, "raw data carries only projected statistics");
});

test("statistics: a large generated event (60 teams, 3,600 match records) is correct and fast", async () => {
  // Separate gateway so this dataset is independent of the event dataset.
  const gateway = new FakeSyncGateway();
  await gateway.start();
  const previous = { ...process.env };
  Object.assign(process.env, { COUCHBASE_SYNC_GATEWAY_URL: gateway.origin, COUCHBASE_DATABASE: FAKE_DATABASE, COUCHBASE_USERNAME: FAKE_USERNAME, COUCHBASE_PASSWORD: FAKE_PASSWORD });
  try {
    const random = seededRandom(Number(process.env.TEST_SEED ?? 1));
    const expected: Array<{ team: number; rank: number; autoPpg: number }> = [];
    for (let index = 0; index < 60; index += 1) {
      const team = 100 + index * 37;
      const rank = index < 50 ? 50 - index : 0; // ten unranked teams
      const autoPpg = Math.round(random() * 400) / 10;
      gateway.put(`aggregate_${team}`, { type: "aggregate_data", team, data: { standing: rank, matchesPlayed: 60, autoPPG: autoPpg } });
      gateway.put(`pit_${team}`, { type: "pit", team, data: { teamName: `Team name ${team}` } });
      for (let match = 1; match <= 60; match += 1) gateway.put(`scouting_${team}_${match}`, { type: "scouting_data", team, data: { start: { match } } });
      expected.push({ team, rank, autoPpg });
    }
    // Ranked teams by rank (the generator assigned rank 50..1 to indexes 0..49), then unranked by team number.
    expected.sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || a.team - b.team);
    mock.timers.tick(21_000);
    const started = performance.now();
    const { teams } = await fetchTeamAggregatesSnapshot();
    const elapsed = performance.now() - started;
    assert.deepEqual(teams.map(({ team, rank, autoPpg }) => ({ team, rank, autoPpg })), expected);
    assert.ok(teams.every((team) => team.name === `Team name ${team.team}`));
    // Generous bound: a 3,600-record event must never take seconds to aggregate.
    assert.ok(elapsed < 3000, `snapshot took ${elapsed.toFixed(0)} ms`);
  } finally {
    Object.assign(process.env, previous);
    await gateway.stop();
  }
});

// ---------------------------------------------------------------- convergence

type Operation = { kind: "aggregate"; team: number; standing: number; matches: number } | { kind: "pit"; team: number; name: string } | { kind: "delete"; id: string };
const teamArb = fc.constantFrom(11, 22, 33, 44);
const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant("aggregate" as const), team: teamArb, standing: fc.nat(8), matches: fc.nat(12) }),
  fc.record({ kind: fc.constant("pit" as const), team: teamArb, name: fc.constantFrom("Alpha", "Bravo", "Charlie", " Delta ") }),
  fc.record({ kind: fc.constant("delete" as const), id: fc.constantFrom("aggregate_11", "aggregate_22", "pit_33", "pit_44", "aggregate_44") }),
);

async function apply(gateway: FakeSyncGateway, operation: Operation) {
  if (operation.kind === "aggregate") gateway.put(`aggregate_${operation.team}`, { type: "aggregate_data", team: operation.team, data: { standing: operation.standing, matchesPlayed: operation.matches } });
  else if (operation.kind === "pit") gateway.put(`pit_${operation.team}`, { type: "pit", team: operation.team, data: { teamName: operation.name } });
  else if (gateway.docs.get(operation.id) && !gateway.docs.get(operation.id)!.deleted) gateway.delete(operation.id);
}

test("property: a page left open with live updates shows the same teams as a freshly loaded page", async () => {
  await fc.assert(fc.asyncProperty(fc.array(operationArb, { maxLength: 8 }), fc.array(operationArb, { minLength: 1, maxLength: 10 }), async (history, live) => {
    const gateway = new FakeSyncGateway();
    await gateway.start();
    const previous = { ...process.env };
    Object.assign(process.env, { COUCHBASE_SYNC_GATEWAY_URL: gateway.origin, COUCHBASE_DATABASE: FAKE_DATABASE, COUCHBASE_USERNAME: FAKE_USERNAME, COUCHBASE_PASSWORD: FAKE_PASSWORD });
    try {
      for (const operation of history) await apply(gateway, operation);
      mock.timers.tick(21_000);
      const opened = await fetchTeamAggregatesSnapshot();
      for (const operation of live) await apply(gateway, operation);

      // Everything the realtime feed relays after the snapshot's cursor, applied to the open page.
      const response = await fetch(`${gateway.origin}/${FAKE_DATABASE}/_changes?since=${opened.lastSeq}&include_docs=true`, { headers: { Authorization: FAKE_AUTH } });
      const store = new DocumentStore();
      for (const frame of parseChangesFrame(((await response.json()) as { results: unknown[] }).results)) if (frame.type === "change") store.apply(frame as RealtimeChange);
      const openPage = mergeAggregates(opened.teams, store, opened.names);

      mock.timers.tick(21_000);
      const freshPage = (await fetchTeamAggregatesSnapshot()).teams;
      assert.deepEqual(view(openPage), view(freshPage));
    } finally {
      Object.assign(process.env, previous);
      await gateway.stop();
    }
  }), { numRuns: 60 });
});
