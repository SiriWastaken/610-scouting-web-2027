// Aggregate documents -> TeamAggregate rows, and realtime merges on top of a
// server snapshot. Expected values are written out by hand from the inputs.
import assert from "node:assert/strict";
import test from "node:test";
import { getDocumentTeam, getDocumentTeamName, mergeAggregates, normalizeAggregateDocument } from "../../../lib/normalize-aggregate.ts";
import { DocumentStore } from "../../../lib/realtime-store.ts";
import type { TeamAggregate } from "../../../types/scouting.ts";

const full = {
  _id: "aggregate_610", _rev: "3-abc", type: "aggregate_data", timestamp: "2027-03-01T10:00:00Z", team: 610,
  data: {
    standing: 4, matchesPlayed: 11, autoPPG: 12.25, teleopPPG: 30.5, endgamePPG: 9.75, fuelscored: 17.4,
    teleopFuelaccuracy: 83.6, autoFuelaccuracy: 40, avgDefenseSkill: 3.5, avgDriverSkill: 8.25, brokePercentage: 9.09,
  },
};

test("normalize: maps every dashboard field from a complete aggregate document", () => {
  assert.deepEqual(normalizeAggregateDocument(full, new Map([[610, "Crescent Coyotes"]])), {
    team: 610, name: "Crescent Coyotes", recordedAt: "2027-03-01T10:00:00Z", sourceId: "aggregate_610", rev: "3-abc",
    rawData: full.data, rank: 4, matches: 11, autoPpg: 12.25, teleopPpg: 30.5, endgamePpg: 9.75, fuelPerMatch: 17.4,
    fuelAccuracy: 84, defenseRating: 3.5, driverSkill: 8.25, breakRate: 9,
  });
});

test("normalize: falls back to a generic team name and drops invalid revisions", () => {
  const row = normalizeAggregateDocument({ ...full, _rev: "not-a-rev" });
  assert.equal(row?.name, "Team 610");
  assert.equal(row?.rev, undefined);
});

test("normalize: missing data or team yields no row instead of a phantom team", () => {
  assert.equal(normalizeAggregateDocument({ _id: "aggregate_1", team: 1 }), null, "no data object");
  assert.equal(normalizeAggregateDocument({ _id: "aggregate_1", team: 1, data: {} }), null, "empty statistics");
  assert.equal(normalizeAggregateDocument({ _id: "stray", data: { standing: 1 } }), null, "no team anywhere");
  assert.equal(normalizeAggregateDocument({ team: 0, data: { standing: 1 } }), null, "team 0");
  assert.equal(normalizeAggregateDocument({ team: "abc", data: {} }), null, "non-numeric team");
  assert.equal(normalizeAggregateDocument({ team: null as unknown as number, data: {} }), null, "null team");
});

test("normalize: invalid team numbers (negative, fractional, absurd) are rejected", () => {
  for (const team of [-5, "-610", 1.5, "610.5", 1e21, Number.MAX_SAFE_INTEGER + 2, "Infinity", "1e400"]) {
    assert.equal(normalizeAggregateDocument({ team: team as number, data: { standing: 1 } }), null, `team ${String(team)}`);
  }
});

test("normalize: an aggregate's id supplies its team when the body has none, and must agree when it has one", () => {
  assert.equal(normalizeAggregateDocument({ _id: "aggregate_118", data: { standing: 4 } })?.team, 118);
  assert.equal(normalizeAggregateDocument({ _id: "aggregate_5000", team: 254, data: { standing: 7 } }), null, "a body claiming another team is corrupt");
  assert.equal(normalizeAggregateDocument({ _id: "aggregate_254", team: "254", data: { standing: 2 } })?.team, 254);
});

test("normalize: team number comes from the document, then data.team, then data.teamNumber", () => {
  assert.equal(getDocumentTeam({ team: "254", data: { team: 1, teamNumber: 2 } }), 254);
  assert.equal(getDocumentTeam({ data: { team: 1678, teamNumber: 2 } }), 1678);
  assert.equal(getDocumentTeam({ data: { teamNumber: "971" } }), 971);
  assert.equal(getDocumentTeam({}), 0);
});

test("normalize: empty and zero statistics are zero, never NaN", () => {
  const row = normalizeAggregateDocument({ team: 1, data: { standing: 0, matchesPlayed: 0, teleopFuelaccuracy: 0, autoFuelaccuracy: 90 } });
  assert.ok(row);
  assert.deepEqual([row.rank, row.matches, row.autoPpg, row.teleopPpg, row.endgamePpg, row.fuelPerMatch, row.fuelAccuracy, row.defenseRating, row.driverSkill, row.breakRate], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "an explicit 0% teleop accuracy is kept, not replaced by the auto accuracy");
});

test("normalize: malformed statistic values degrade to 0 instead of NaN or Infinity", () => {
  const row = normalizeAggregateDocument({ team: 2, data: { standing: "first", matchesPlayed: null, autoPPG: {}, teleopPPG: Number.NaN, endgamePPG: "Infinity", fuelscored: "1e400", brokePercentage: undefined, avgDriverSkill: Number.POSITIVE_INFINITY } });
  assert.ok(row);
  for (const key of ["rank", "matches", "autoPpg", "teleopPpg", "endgamePpg", "fuelPerMatch", "breakRate", "driverSkill"] as const) {
    assert.equal(row[key], 0, key);
  }
});

test("normalize: numeric strings from older scouting builds are read as numbers", () => {
  const row = normalizeAggregateDocument({ team: "3", data: { standing: "2", matchesPlayed: "7", autoPPG: "4.5", teleopFuelaccuracy: "66.5" } });
  assert.deepEqual([row?.team, row?.rank, row?.matches, row?.autoPpg, row?.fuelAccuracy], [3, 2, 7, 4.5, 67]);
});

test("normalize: fuel accuracy uses teleop accuracy, falling back to auto only when teleop is absent", () => {
  assert.equal(normalizeAggregateDocument({ team: 1, data: { autoFuelaccuracy: 72.4 } })?.fuelAccuracy, 72);
  assert.equal(normalizeAggregateDocument({ team: 1, data: { teleopFuelaccuracy: null, autoFuelaccuracy: 72.5 } })?.fuelAccuracy, 73);
  assert.equal(normalizeAggregateDocument({ team: 1, data: { teleopFuelaccuracy: 12.49, autoFuelaccuracy: 99 } })?.fuelAccuracy, 12);
});

test("team names: trimmed, from data or the document, and never blank", () => {
  assert.equal(getDocumentTeamName({ data: { teamName: "  Citrus Circuits  " } }), "Citrus Circuits");
  assert.equal(getDocumentTeamName({ data: { team_name: "The Cheesy Poofs" } }), "The Cheesy Poofs");
  assert.equal(getDocumentTeamName({ name: "Top-level" }), "Top-level");
  assert.equal(getDocumentTeamName({ data: { teamName: "   " } }), undefined);
  assert.equal(getDocumentTeamName({ data: { teamName: 610 } }), undefined);
  assert.equal(getDocumentTeamName({ data: { teamName: "Équipe Été 🤖" } }), "Équipe Été 🤖");
});

// ---------------------------------------------------------------- merges

const row = (team: number, rank: number, rev: string, name = `Team ${team}`): TeamAggregate => ({
  team, name, rank, rev, sourceId: `aggregate_${team}`, rawData: {}, matches: 1,
  autoPpg: 0, teleopPpg: 0, endgamePpg: 0, fuelPerMatch: 0, fuelAccuracy: 0, defenseRating: 0, driverSkill: 0, breakRate: 0,
});
const aggregateChange = (team: number, rev: string, seq: number, data: Record<string, unknown>) =>
  ({ type: "change" as const, id: `aggregate_${team}`, rev, seq, deleted: false, doc: { _id: `aggregate_${team}`, _rev: rev, type: "aggregate_data", team, data } });

test("merge: returns the snapshot itself when the store adds nothing (stable for React memoisation)", () => {
  const snapshot = [row(610, 1, "2-a")];
  const store = new DocumentStore();
  assert.equal(mergeAggregates(snapshot, store), snapshot);
  store.apply({ type: "change", id: "scouting_610_1", rev: "1-a", seq: 1, deleted: false, doc: { _id: "scouting_610_1" } });
  assert.equal(mergeAggregates(snapshot, store), snapshot, "unrelated documents do not rebuild the list");
  store.apply(aggregateChange(610, "2-a", 2, { standing: 1, matchesPlayed: 1 }));
  assert.equal(mergeAggregates(snapshot, store), snapshot, "the same revision as the snapshot is not new");
});

test("merge: ranked teams first by rank, unranked (0) last, ties broken by team number", () => {
  const store = new DocumentStore();
  store.apply(aggregateChange(9000, "1-a", 1, { standing: 0 }));
  store.apply(aggregateChange(5, "1-a", 2, { standing: 2 }));
  store.apply(aggregateChange(4, "1-a", 3, { standing: 2 }));
  store.apply(aggregateChange(100, "1-a", 4, { standing: 0 }));
  store.apply(aggregateChange(7, "1-a", 5, { standing: 1 }));
  assert.deepEqual(mergeAggregates([], store).map((team) => team.team), [7, 4, 5, 100, 9000]);
});

test("merge: an older revision from the feed never replaces a newer snapshot row", () => {
  const snapshot = [row(610, 1, "5-z")];
  const store = new DocumentStore();
  store.apply(aggregateChange(610, "4-z", 1, { standing: 9 }));
  assert.equal(mergeAggregates(snapshot, store)[0].rank, 1);
});

test("merge: deleting a team removes only that team; deleting an unknown team is a no-op", () => {
  const snapshot = [row(610, 1, "1-a"), row(254, 2, "1-a")];
  const store = new DocumentStore();
  store.apply({ type: "change", id: "aggregate_999", rev: "2-d", seq: 1, deleted: true });
  assert.equal(mergeAggregates(snapshot, store), snapshot);
  store.apply({ type: "change", id: "aggregate_610", rev: "2-d", seq: 2, deleted: true });
  assert.deepEqual(mergeAggregates(snapshot, store).map((team) => team.team), [254]);
});

test("merge: a newer but unusable aggregate revision leaves the last good row in place", () => {
  const snapshot = [row(610, 1, "1-a")];
  const store = new DocumentStore();
  store.apply({ type: "change", id: "aggregate_610", rev: "2-a", seq: 1, deleted: false, doc: { _id: "aggregate_610", type: "aggregate_data", team: 610 } });
  assert.deepEqual(mergeAggregates(snapshot, store).map((team) => [team.team, team.rank]), [[610, 1]]);
});

test("merge: pit names rename existing rows and survive later aggregate updates", () => {
  const snapshot = [row(610, 1, "1-a")];
  const store = new DocumentStore();
  store.apply({ type: "change", id: "pit_610", rev: "1-p", seq: 1, deleted: false, doc: { _id: "pit_610", type: "pit", data: { teamName: "Crescent Coyotes" } } });
  assert.equal(mergeAggregates(snapshot, store)[0].name, "Crescent Coyotes");
  store.apply(aggregateChange(610, "2-a", 2, { standing: 3 }));
  assert.deepEqual(mergeAggregates(snapshot, store).map((team) => [team.name, team.rank]), [["Crescent Coyotes", 3]]);
});

test("merge: a snapshot row keeps its server-provided name when an aggregate update arrives", () => {
  const snapshot = [row(1678, 2, "1-a", "Citrus Circuits")];
  const store = new DocumentStore();
  store.apply(aggregateChange(1678, "2-b", 1, { standing: 1 }));
  assert.equal(mergeAggregates(snapshot, store)[0].name, "Citrus Circuits");
});
