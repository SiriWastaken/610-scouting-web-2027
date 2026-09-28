// Match documents are sanitised before the Teams page renders them, so one bad
// submission from one tablet cannot crash the page for everyone.
import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeMatchData } from "../../../lib/data/match-data.ts";

test("sanitizer: a well-formed match passes through unchanged", () => {
  const data = {
    teamNumber: 610,
    start: { match: 4, alliance: "blue", position: "b1", scoutName: "A", practice: false },
    auto: { fuelScored: 3, fuelFed: 1, hangLevel: 1, markers: [{ x: 0.5, y: 0.25, type: "pickup" }], paths: ["M 0.1,0.2 L 0.3,0.4"], fieldFlipped: true },
    teleop: { fuelscored: 20, fuelpassed: 2, fuelPlowed: 1, teleopFuelFed: 3, L1hang: 0, missedL1: 0, L2hang: 1, missedL2: 0, L3hang: 0, missedL3: 1, playedDefense: 1, breakDuration: 5, breakSeverity: "minor", general: "note" },
  };
  assert.deepEqual(sanitizeMatchData(data, "scouting_610_4"), { _id: "scouting_610_4", ...data });
});

test("sanitizer: values of the wrong type are dropped, never passed to rendering code", () => {
  const result = sanitizeMatchData({
    start: { match: "six", alliance: 42, position: {}, practice: "yes" },
    auto: { markers: [[1, 2], { x: "a", y: 1, type: "pickup" }, null, { x: 1, y: 2, type: "teleport" }, { x: 1, y: 2, type: "scoring" }], paths: [7, null, "M 0,0"], fuelScored: "many", fieldFlipped: 1 },
    teleop: { fuelscored: { value: 3 }, breakSeverity: ["bad"], general: 5, L2hang: Number.NaN },
  }, "scouting_610_6", 6);
  assert.deepEqual(result, {
    _id: "scouting_610_6",
    start: { match: 6 },
    auto: { markers: [{ x: 1, y: 2, type: "scoring" }], paths: ["M 0,0"] },
    teleop: {},
  });
});

test("sanitizer: numeric strings from older app versions are read as numbers", () => {
  assert.deepEqual(sanitizeMatchData({ start: { match: "12" }, teleop: { fuelscored: "7", breakSeverity: 2 } }).start, { match: 12 });
  assert.deepEqual(sanitizeMatchData({ teleop: { fuelscored: "7", breakSeverity: 2, missedL1: " " } }).teleop, { fuelscored: 7, breakSeverity: 2 });
});

test("sanitizer: missing or non-object bodies and sections become empty sections", () => {
  for (const data of [undefined, null, 42, "text", [], { start: [], auto: "x", teleop: null }]) {
    assert.deepEqual(sanitizeMatchData(data), { start: {}, auto: {}, teleop: {} }, JSON.stringify(data));
  }
  assert.deepEqual(sanitizeMatchData({}, undefined, 3).start, { match: 3 }, "match number from the document id");
});
