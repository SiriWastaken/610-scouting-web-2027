// The object model: a ScoutingEvent holds Teams, a Team holds Matches, a pit interview and cards, and an
// Alliance groups Teams. Expected values are worked out by hand in the comments.
import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeMatchData } from "../../../lib/data/match-data.ts";
import { Alliance } from "../../../lib/domain/alliance.ts";
import { Match } from "../../../lib/domain/match.ts";
import { PitInterview } from "../../../lib/domain/pit-interview.ts";
import { ScoutingEvent } from "../../../lib/domain/scouting-event.ts";
import { Team } from "../../../lib/domain/team.ts";
import type { TeamAggregate } from "../../../types/scouting.ts";

function row(team: number, raw: Record<string, unknown>, matches = 6, rank = team): TeamAggregate {
  return {
    team, name: `Team ${team}`, rawData: raw, rank, matches,
    autoPpg: Number(raw.autoPPG ?? 0), teleopPpg: Number(raw.teleopPPG ?? 0), endgamePpg: Number(raw.endgamePPG ?? 0), fuelPerMatch: 0,
    fuelAccuracy: Number(raw.teleopFuelaccuracy ?? 0), defenseRating: 0, driverSkill: 0, breakRate: 0,
  };
}
const phases = (auto: number, teleop: number, endgame: number) => ({ autoPPG: auto, teleopPPG: teleop, endgamePPG: endgame });

test("Match: climb level is the highest rung hung from, and attempts count misses too", () => {
  const match = (teleop: Record<string, unknown>) => new Match(sanitizeMatchData({ start: { match: 12, alliance: "Blue" }, teleop }));
  assert.equal(match({ L1hang: 1, L2hang: 1 }).climbLevel, "L2");
  assert.equal(match({ L3hang: 1 }).climbLevel, "L3");
  assert.equal(match({ missedL3: 1 }).climbLevel, "-", "a miss is not a climb");
  assert.equal(match({ missedL3: 1 }).attemptedClimb, true, "but it is an attempt");
  assert.equal(match({}).attemptedClimb, false);
  assert.equal(match({}).number, 12);
  assert.equal(match({}).allianceColor, "blue");
});

test("Match: an unrecorded alliance reads as red for colouring but is reported as unknown", () => {
  const match = new Match(sanitizeMatchData({ start: { alliance: "purple" } }));
  assert.equal(match.allianceColor, "red");
  assert.equal(match.hasAlliance, false);
  assert.equal(new Match(sanitizeMatchData({ teleop: { general: "" } })).notes, undefined, "empty notes are no notes");
});

test("PitInterview: photos come as a URL, bare base64, or a data URI, and a blob without content is no photo", () => {
  const photo = (robotPhoto: unknown) => new PitInterview({ robotPhoto } as never).photoUri();
  assert.equal(photo("https://example.org/a.jpg"), "https://example.org/a.jpg");
  assert.equal(photo({ content: "QUJD", contentType: "image/png" }), "data:image/png;base64,QUJD");
  assert.equal(photo({ data: "data:image/jpeg;base64,QUJD" }), "data:image/jpeg;base64,QUJD", "a data: prefix is not doubled");
  assert.equal(photo({}), null);
  assert.equal(photo(null), null);
});

test("PitInterview: accepts answers under `data` or at the top level, and detects legacy answers", () => {
  assert.equal(PitInterview.fromDocument({ data: { scoutName: "Ada" } }).scoutName, "Ada");
  assert.equal(PitInterview.fromDocument({ scoutName: "Bo" }).scoutName, "Bo");
  assert.equal(new PitInterview({}).hasLegacyAnswers(), false);
  assert.equal(new PitInterview({ idealAlliance: "us" }).hasLegacyAnswers(), true);
  assert.equal(new PitInterview({ hasRobotName: "Yes" }).namesItsRobot(), true);
});

test("Team: loading detail returns a new Team and keeps what was not replaced", () => {
  const plain = Team.fromAggregate(row(34, phases(1, 2, 3)));
  const match = new Match(sanitizeMatchData({ start: { match: 1 }, teleop: { L2hang: 1 } }));
  const withMatches = plain.withDetail({ matches: [match] });
  const withPit = withMatches.withDetail({ pit: new PitInterview({}) });
  assert.notEqual(withMatches, plain, "a new object");
  assert.equal(plain.matches.length, 0, "the original is untouched");
  assert.equal(withPit.matches.length, 1, "matches kept when only the pit changes");
  assert.ok(withPit.pit);
  assert.equal(withPit.bestClimb(), "L2");
  assert.equal(plain.bestClimb(), "-");
});

test("Team: name, nickname, low sample and complete record", () => {
  const team = Team.fromAggregate(row(34, { ...phases(1, 2, 3), teleopFuelaccuracy: 80 }, 2));
  assert.equal(team.displayName(), "Team 34");
  assert.equal(team.displayName("Cheesy"), "Cheesy");
  assert.equal(team.isLowSample(), true, "2 matches is below the threshold of 3");
  assert.equal(team.hasCompleteRecord(), true);
  assert.equal(Team.fromAggregate(row(35, phases(1, 2, 3), 6, 0)).hasCompleteRecord(), false, "unranked");
});

test("Team: compareTo says who leads, and nobody leads against a blank", () => {
  const strong = Team.fromAggregate(row(1, phases(10, 20, 10)));   // total 40
  const weak = Team.fromAggregate(row(2, phases(5, 10, 5)));       // total 20
  const blank = Team.fromAggregate(row(3, {}));
  assert.deepEqual(strong.compareTo(weak, "total"), { leader: "a", margin: 20 });
  assert.deepEqual(weak.compareTo(strong, "total"), { leader: "b", margin: 20 });
  assert.equal(strong.compareTo(blank, "total").leader, null);
});

test("ScoutingEvent: finds teams by number, falls back to the first, and replaces one team at a time", () => {
  const event = ScoutingEvent.fromAggregates([row(7, phases(1, 1, 1)), row(9, phases(2, 2, 2))]);
  assert.equal(event.size, 2);
  assert.equal(event.team(9)?.number, 9);
  assert.equal(event.team(8), undefined);
  assert.equal(event.teamOrFirst(8)?.number, 7);
  assert.equal(event.teamOrFirst(null)?.number, 7);
  assert.equal(ScoutingEvent.fromAggregates([]).teamOrFirst(7), null);
  const updated = event.withTeam(event.team(9)!.withDetail({ pit: new PitInterview({}) }));
  assert.ok(updated.team(9)?.pit);
  assert.equal(event.team(9)?.pit, null, "the original event is untouched");
});

test("ScoutingEvent: coverage counts teams with a complete record and is 0 for an empty event", () => {
  const complete = (n: number) => row(n, { ...phases(1, 1, 1), teleopFuelaccuracy: 50 });
  const event = ScoutingEvent.fromAggregates([complete(1), complete(2), complete(3), row(4, {}, 0)]);
  // 3 complete of 4 = 75%; matches observed = 6 + 6 + 6 + 0.
  assert.equal(event.completeTeams.length, 3);
  assert.equal(event.coveragePercent, 75);
  assert.equal(event.observedMatches, 18);
  assert.equal(ScoutingEvent.fromAggregates([]).coveragePercent, 0);
});

test("ScoutingEvent: outliers are judged against the whole field, and a team without data never is", () => {
  // Five teams are needed before anything can be flagged. Four near 10 and one at 100: 100 is far above 3x the median (10).
  const rows = [10, 11, 9, 10, 100].map((total, i) => row(i + 1, phases(total, 0, 0)));
  const event = ScoutingEvent.fromAggregates([...rows, row(6, {})]);
  assert.equal(event.isOutlier(event.team(5)!, "autoPpg"), true);
  assert.equal(event.isOutlier(event.team(1)!, "autoPpg"), false);
  assert.equal(event.isOutlier(event.team(6)!, "autoPpg"), false);
});

test("Alliance: the score sums totals, a robot with no data adds 0, and unscouted numbers are skipped", () => {
  const event = ScoutingEvent.fromAggregates([row(1, phases(10, 20, 10)), row(2, phases(5, 10, 5)), row(3, {})]);
  const red = event.alliance("red", [1, 2, 3, 999]);
  assert.equal(red.robots.length, 3, "999 was never scouted");
  assert.equal(red.score, 60, "40 + 20 + 0");
  assert.deepEqual(red.sampleSizes, [6, 6, 6]);
  assert.equal(event.alliance("blue", []).scoreOrNull, null);
  assert.equal(event.alliance("blue", []).isEmpty, true);
});

test("Alliance: compareTo finds the stronger side and confidence reasons name the weak spots", () => {
  const event = ScoutingEvent.fromAggregates([row(1, phases(10, 20, 10)), row(2, phases(5, 10, 5), 1), row(3, {})]);
  const strong = event.alliance("red", [1]);
  const weak = event.alliance("blue", [2, 3]);
  assert.deepEqual(strong.compareTo(weak), { leader: "a", margin: 20 });
  assert.equal(strong.compareTo(new Alliance("blue", [])).leader, null, "nothing to compare against");
  assert.deepEqual(weak.confidenceReasons(event.fieldValues("total")), ["2: 1 match", "3: no data"]);
  assert.deepEqual(strong.confidenceReasons(event.fieldValues("total")), []);
});
