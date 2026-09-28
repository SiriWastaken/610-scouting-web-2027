// A small, deterministic event dataset with edge cases. Every expected value
// below was worked out by hand from the documents; none is computed by
// application code. Keep them that way: if a rule changes, recompute the
// affected numbers by hand and explain the change in the commit.

export const eventDocuments: Record<string, Record<string, unknown>> = {
  // ---- aggregates (one per team, keyed aggregate_<team>)
  aggregate_610: { type: "aggregate_data", team: 610, timestamp: "2027-03-02T18:00:00Z", data: { standing: 1, matchesPlayed: 10, autoPPG: 12.5, teleopPPG: 30, endgamePPG: 10, fuelscored: 22.4, teleopFuelaccuracy: 81.6, autoFuelaccuracy: 50, avgDefenseSkill: 2, avgDriverSkill: 8.5, brokePercentage: 10, scoutNames: ["private"] } },
  aggregate_254: { type: "aggregate_data", team: 254, data: { standing: 2, matchesPlayed: 9, autoPPG: 15, teleopPPG: 28.25, endgamePPG: 12, fuelscored: 25, teleopFuelaccuracy: 90.4, avgDefenseSkill: 1.5, avgDriverSkill: 9, brokePercentage: 0 } },
  // numeric strings from an older aggregator; accuracy only for auto
  aggregate_1678: { type: "aggregate_data", team: "1678", data: { standing: "3", matchesPlayed: 10, autoPPG: "11", teleopPPG: 26, endgamePPG: 8, fuelscored: 19.5, autoFuelaccuracy: 70.5, avgDefenseSkill: 3, avgDriverSkill: 7, brokePercentage: 20 } },
  // unranked team with no matches yet: every statistic is zero
  aggregate_971: { type: "aggregate_data", team: 971, data: { standing: 0, matchesPlayed: 0 } },
  // partial/malformed statistics: garbage fuel, explicit 0% accuracy, null defense, a .5 break rate
  aggregate_118: { type: "aggregate_data", data: { teamNumber: 118, standing: 4, matchesPlayed: 8, autoPPG: 9, teleopPPG: 20, endgamePPG: 6, fuelscored: "bogus", teleopFuelaccuracy: 0, autoFuelaccuracy: 95, avgDefenseSkill: null, avgDriverSkill: 6.25, brokePercentage: 12.5 } },
  // invalid records that must not produce rows
  aggregate_7: { type: "aggregate_data", team: -7, data: { standing: 5, matchesPlayed: 1 } },
  aggregate_8: { type: "pit", team: 8, data: { standing: 6 } },
  aggregate_9: { type: "aggregate_data", team: 9 },
  // conflicting duplicate: claims to be team 254 but is stored under another team's id
  aggregate_5000: { type: "aggregate_data", team: 254, data: { standing: 7, matchesPlayed: 99, autoPPG: 99 } },

  // ---- pit interviews (names)
  pit_610: { type: "pit", team: 610, data: { teamName: "Crescent Coyotes", drivetrainType: "swerve", robotPhoto: { content: "AAAA" }, notes: "private" } },
  pit_254: { type: "pit", team: 254, data: { teamName: "  The Cheesy Poofs  " } },
  pit_1678: { type: "pit", team: 1678, data: { teamName: "" } },
  pit_118: { type: "pit", data: { teamNumber: 118, teamName: "Robonauts" } },
  pit_9999: { type: "pit", team: 9999, data: { teamName: "No Aggregate Yet" } },

  // ---- match scouting for team 610 (and a prefix-colliding team 6100)
  scouting_610_1: { type: "scouting_data", team: 610, data: { teamNumber: 610, start: { match: 1, alliance: "red", position: "r1", scoutName: "Alex" }, auto: { fuelScored: 3, fuelFed: 1 }, teleop: { fuelscored: 20, L2hang: 1, general: "private note" } } },
  scouting_610_2: { data: { start: { alliance: "blue", position: "b3" }, teleop: { fuelscored: 0, missedL3: 1 } } },
  scouting_610_10: { type: "scouting_data", team: 610, data: { start: { match: 10, alliance: "red", practice: true }, teleop: { fuelscored: 31, playedDefense: 1, breakDuration: 12, breakSeverity: "minor" } } },
  scouting_6100_1: { type: "scouting_data", team: 6100, data: { start: { match: 1 } } },
  scouting_610_x: { type: "scouting_data", team: 610, data: { start: { match: 99 } } },
  scouting_610_3: { type: "match_notes", team: 610, data: { start: { match: 3 } } },

  // ---- card reports
  report_card_610_Q1: { type: "report_card", team: 610, match: 1, timestamp: "2027-03-02T15:00:00Z", data: { cardType: "Yellow", ruleViolation: "G204", notes: "private" } },
  report_610_Q7: { type: "report_card", team: 610, match: 7, data: { cardType: "Red", ruleViolation: "G301" } },
  report_6100_Q1: { type: "report_card", team: 6100, match: 1, data: { cardType: "Yellow" } },

  // ---- unrelated documents that live in the same bucket
  event_schedule: { type: "schedule", matches: [] },
  users_admin: { type: "user", password: "hunter2" },
};

/** Team rows in dashboard order (rank ascending, unranked last, then team number). */
export const expectedTeams = [
  { team: 610, name: "Crescent Coyotes", rank: 1, matches: 10, autoPpg: 12.5, teleopPpg: 30, endgamePpg: 10, fuelPerMatch: 22.4, fuelAccuracy: 82, defenseRating: 2, driverSkill: 8.5, breakRate: 10 },
  { team: 254, name: "The Cheesy Poofs", rank: 2, matches: 9, autoPpg: 15, teleopPpg: 28.25, endgamePpg: 12, fuelPerMatch: 25, fuelAccuracy: 90, defenseRating: 1.5, driverSkill: 9, breakRate: 0 },
  { team: 1678, name: "Team 1678", rank: 3, matches: 10, autoPpg: 11, teleopPpg: 26, endgamePpg: 8, fuelPerMatch: 19.5, fuelAccuracy: 71, defenseRating: 3, driverSkill: 7, breakRate: 20 },
  { team: 118, name: "Robonauts", rank: 4, matches: 8, autoPpg: 9, teleopPpg: 20, endgamePpg: 6, fuelPerMatch: 0, fuelAccuracy: 0, defenseRating: 0, driverSkill: 6.25, breakRate: 13 },
  { team: 971, name: "Team 971", rank: 0, matches: 0, autoPpg: 0, teleopPpg: 0, endgamePpg: 0, fuelPerMatch: 0, fuelAccuracy: 0, defenseRating: 0, driverSkill: 0, breakRate: 0 },
];

/** Coverage page: 5 teams; 10+9+10+8+0 = 37 matches; complete = matches>0, rank>0, accuracy>0 -> 610, 254, 1678 = 3/5 = 60%. */
export const expectedCoverage = { teams: 5, observedMatches: 37, completePercent: 60, ready: [610, 254, 1678], check: [118, 971] };

/** Strategy default alliance (first three rows): (12.5+30+10) + (15+28.25+12) + (11+26+8) = 52.5 + 55.25 + 45 = 152.75. */
export const expectedDefaultAllianceScore = "152.8";

/**
 * Averages board sorted by the raw "Fuel scored / match" value. Numbers sort by
 * value; teams without a numeric value (118 has "bogus", 971 has none) stay
 * last in both directions, in their rank order.
 */
export const expectedFuelAscending = [1678, 610, 254, 118, 971];
export const expectedFuelDescending = [254, 610, 1678, 118, 971];

/** Match documents served for team 610 (not 6100, not the malformed id, not the wrong type). */
export const expectedMatchIds610 = ["scouting_610_1", "scouting_610_10", "scouting_610_2"];
/** Card reports served for team 610. */
export const expectedReportIds610 = ["report_610_Q7", "report_card_610_Q1"];

/** Strings that exist in the dataset but must never leave the server. */
export const privateStrings = ["Alex", "private note", "private", "hunter2", "AAAA"];
