// Missing-vs-zero, sample-size and outlier rules, comparisons and number formatting
// behind the Strategy page. Expected values are worked out by hand in the comments.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAggregateDocument } from "../../../lib/data/aggregates.ts";
import {
  compareValues, formatMargin, formatMatches, formatPercentMargin, formatPercent, formatPoints, formatRating, isOutlier,
  LOW_SAMPLE_THRESHOLD, median, NO_DATA,
} from "../../../lib/data/team-stats.ts";
import { ScoutingEvent } from "../../../lib/domain/scouting-event.ts";
import { Team, type StatKey, type StatName } from "../../../lib/domain/team.ts";
import type { TeamAggregate } from "../../../types/scouting.ts";

// The reading rules live on Team and ScoutingEvent; these adapters keep each test about one rule.
const statValue = (row: TeamAggregate, key: StatKey) => Team.fromAggregate(row).statValue(key);
const totalPoints = (row: TeamAggregate) => Team.fromAggregate(row).totalPoints();
const isLowSample = (matches: number) => Team.fromAggregate(team({}, matches)).isLowSample();
const fieldValues = (rows: TeamAggregate[], key: StatName) => ScoutingEvent.fromAggregates(rows).fieldValues(key);

function team(raw: Record<string, unknown>, matches = 6): TeamAggregate {
  return {
    team: 34, name: "Team 34", rawData: raw, rank: 1, matches,
    autoPpg: Number(raw.autoPPG ?? 0), teleopPpg: Number(raw.teleopPPG ?? 0), endgamePpg: Number(raw.endgamePPG ?? 0), fuelPerMatch: 0,
    fuelAccuracy: Math.round(Number(raw.teleopFuelaccuracy ?? raw.autoFuelaccuracy ?? 0)), defenseRating: Number(raw.avgDefenseSkill ?? 0), driverSkill: Number(raw.avgDriverSkill ?? 0), breakRate: 0,
  };
}

test("statValue: a real zero is 0, a missing value is null", () => {
  const row = team({ autoPPG: 0, teleopPPG: 30, avgDriverSkill: "8.5" });
  assert.equal(statValue(row, "autoPpg"), 0, "scouted zero");
  assert.equal(statValue(row, "teleopPpg"), 30);
  assert.equal(statValue(row, "driverSkill"), 8.5, "numeric string counts");
  assert.equal(statValue(row, "endgamePpg"), null, "field absent");
});

test("statValue: null, blank and non-numeric fields are missing", () => {
  const row = team({ avgDefenseSkill: null, avgDriverSkill: "", autoPPG: "bogus", teleopPPG: {}, endgamePPG: Number.NaN });
  for (const key of ["defenseRating", "driverSkill", "autoPpg", "teleopPpg", "endgamePpg"] as const) assert.equal(statValue(row, key), null, key);
});

test("statValue: a team with no scouted matches has no data, whatever the fields say", () => {
  assert.equal(statValue(team({ autoPPG: 0, teleopPPG: 0 }, 0), "autoPpg"), null);
});

test("statValue: fuel accuracy falls back to the auto figure when teleop has none", () => {
  assert.equal(statValue(team({ autoFuelaccuracy: 95 }), "fuelAccuracy"), 95);
  assert.equal(statValue(team({ teleopFuelaccuracy: 0, autoFuelaccuracy: 95 }), "fuelAccuracy"), 0, "a scouted teleop 0 wins over auto");
  assert.equal(statValue(team({}), "fuelAccuracy"), null);
});

test("statValue: reads a normalised aggregate document, so null ratings stay missing", () => {
  const row = normalizeAggregateDocument({ _id: "aggregate_118", data: { teamNumber: 118, matchesPlayed: 8, autoPPG: 9, avgDefenseSkill: null, avgDriverSkill: 6.25 } });
  assert.ok(row);
  assert.equal(statValue(row, "defenseRating"), null);
  assert.equal(statValue(row, "driverSkill"), 6.25);
});

test("totalPoints: auto + teleop + endgame, and null unless all three phases exist", () => {
  assert.equal(totalPoints(team({ autoPPG: 12.5, teleopPPG: 30, endgamePPG: 10 })), 52.5);
  assert.equal(totalPoints(team({ autoPPG: 0, teleopPPG: 0, endgamePPG: 0 })), 0, "scouted zeros total 0, not missing");
  assert.equal(totalPoints(team({ autoPPG: 12.5, teleopPPG: 30 })), null, "endgame missing");
  assert.equal(totalPoints(team({ autoPPG: 1, teleopPPG: 1, endgamePPG: 1 }, 0)), null, "no matches");
});

test("low sample: fewer than the threshold of matches", () => {
  assert.equal(LOW_SAMPLE_THRESHOLD, 3);
  assert.equal(isLowSample(0), true);
  assert.equal(isLowSample(2), true);
  assert.equal(isLowSample(3), false);
  assert.equal(isLowSample(10), false);
});

test("median: odd, even and empty inputs, without reordering the caller's array", () => {
  const values = [5, 1, 3];
  assert.equal(median(values), 3);
  assert.deepEqual(values, [5, 1, 3]);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

test("outlier: more than 2.5 standard deviations from the mean", () => {
  // Nine values, eight 10s and one 29: mean 109/9 = 12.11, population SD 5.97, so 29 is 16.89 / 5.97 = 2.83 SD out.
  // 29 is under 3 x the median (30), so only the SD rule can flag it.
  const high = [10, 10, 10, 10, 10, 10, 10, 10, 29];
  assert.equal(isOutlier(29, high), true);
  assert.equal(isOutlier(10, high), false);
  // Eight 10s and a 0: mean 8.89, SD 3.14, so 0 is 2.83 SD below. Low outliers count too.
  assert.equal(isOutlier(0, [10, 10, 10, 10, 10, 10, 10, 10, 0]), true);
});

test("outlier: more than 3x the median, when the SD rule cannot fire", () => {
  // Five values: the largest possible z-score is 4 / sqrt(5) = 1.79, so only the median rule applies. Median is 1.
  assert.equal(isOutlier(4, [1, 1, 1, 1, 4]), true, "4 > 3 x 1");
  assert.equal(isOutlier(3, [1, 1, 1, 1, 3]), false, "exactly 3 x the median is not over it");
});

test("outlier: a median of 0 disables the multiple rule, and small or flat fields flag nothing", () => {
  // Median 0, mean 1, SD 2, z = 2.0: not an outlier.
  assert.equal(isOutlier(5, [0, 0, 0, 0, 5]), false);
  assert.equal(isOutlier(100, [1, 1, 1, 100]), false, "fewer than 5 teams");
  assert.equal(isOutlier(7, [7, 7, 7, 7, 7, 7]), false, "no spread");
});

test("fieldValues: collects each team's value and skips missing ones", () => {
  const full = team({ autoPPG: 10, teleopPPG: 20, endgamePPG: 5 });
  const partial = team({ autoPPG: 0, teleopPPG: 8 });
  const empty = team({ autoPPG: 3 }, 0);
  assert.deepEqual(fieldValues([full, partial, empty], "autoPpg"), [10, 0]);
  assert.deepEqual(fieldValues([full, partial, empty], "endgamePpg"), [5]);
  assert.deepEqual(fieldValues([full, partial, empty], "total"), [35]);
});

test("compareValues: higher leads, the margin is rounded to what is shown, blanks never win", () => {
  assert.deepEqual(compareValues(60, 12.5), { leader: "a", margin: 47.5 });
  assert.deepEqual(compareValues(12.5, 60), { leader: "b", margin: 47.5 });
  assert.deepEqual(compareValues(0, 4.2), { leader: "b", margin: 4.2 });
  assert.deepEqual(compareValues(12.04, 12), { leader: "tie", margin: 0 }, "both print as 12.0");
  assert.deepEqual(compareValues(0, 0), { leader: "tie", margin: 0 });
  assert.deepEqual(compareValues(null, 5), { leader: null, margin: 0 });
  assert.deepEqual(compareValues(5, null), { leader: null, margin: 0 });
});

test("formatting: points and ratings to one decimal, accuracy as an integer percent, missing as a dash", () => {
  assert.equal(formatPoints(52.5), "52.5");
  assert.equal(formatPoints(30), "30.0");
  assert.equal(formatPoints(0), "0.0");
  assert.equal(formatPoints(null), "—");
  assert.equal(formatPercent(81.6), "82%");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatRating(4.6, 5), "4.6 / 5");
  assert.equal(formatRating(8, 10), "8.0 / 10");
  assert.equal(formatRating(null, 5), "—");
  assert.equal(NO_DATA, "—");
  assert.equal(formatMargin(47.5), "+47.5");
  assert.equal(formatMargin(3), "+3.0");
  assert.equal(formatPercentMargin(8), "+8%");
});

test("formatMatches: singular, plural and none", () => {
  assert.equal(formatMatches(6), "6 matches");
  assert.equal(formatMatches(1), "1 match");
  assert.equal(formatMatches(0), "No matches");
});
