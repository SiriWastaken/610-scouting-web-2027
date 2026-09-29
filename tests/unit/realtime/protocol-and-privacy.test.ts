// Wire protocol and privacy projection: what may leave the server, and what
// the browser will accept.
import assert from "node:assert/strict";
import test from "node:test";
import { compareRevs, isCursor, isDashboardDocument, isRev, parseChangesFrame, parseServerMessage, parseSubscription, projectDashboardDocument } from "../../../lib/realtime/protocol.ts";

test("document ids: only the four dashboard id shapes are relayed", () => {
  const accepted = ["aggregate_610", "scouting_610_12", "pit_1", "report_610_Q12", "report_card_254_Qualification 3", "report_1_a.b-c_d"];
  const rejected = [
    "", "aggregate_", "aggregate_61a", "aggregate_610 ", " aggregate_610", "aggregate_610\n", "Aggregate_610", "scouting_610", "scouting_610_", "scouting_610_x",
    "pit_", "pit_1_2", "report_610_", `report_610_${"x".repeat(129)}`, "report_610_Q1/../../x", "report_610_Q1\u0000", "report_610_ünïcödé",
    "_user/admin", "_sync:seq", "users_admin", "event_schedule", "aggregate_٦١٠" /* Arabic-Indic digits */,
  ];
  for (const id of accepted) assert.equal(isDashboardDocument(id), true, id);
  for (const id of rejected) assert.equal(isDashboardDocument(id), false, JSON.stringify(id));
});

test("revisions: shape is <generation>-<digest>", () => {
  for (const rev of ["1-a", "12-abcdef0123", "9999999999-x", "3-a+b/c=_-"]) assert.equal(isRev(rev), true, rev);
  for (const rev of ["", "0-a", "-a", "1-", "a-1", "01-a", "10000000000-a", `1-${"a".repeat(129)}`, "1-a b", 1, null, undefined, {}]) assert.equal(isRev(rev), false, String(rev));
});

test("revisions: generation is compared numerically, then the digest lexically", () => {
  assert.equal(compareRevs("10-a", "9-z"), 1, "10 > 9 even though '1' < '9'");
  assert.equal(compareRevs("2-a", "2-b"), -1);
  assert.equal(compareRevs("2-b", "2-a"), 1);
  assert.equal(compareRevs("7-same", "7-same"), 0);
  assert.equal(compareRevs("3-a-b", "3-a-c"), -1, "digests containing dashes compare whole");
});

test("cursors: numbers, bounded strings, and bounded JSON values", () => {
  for (const cursor of [0, 5, "12", "12:34", { seq: 1 }, [1, 2]]) assert.equal(isCursor(cursor), true, JSON.stringify(cursor));
  for (const cursor of [-1, Number.NaN, Number.POSITIVE_INFINITY, "", "x".repeat(4097), null, undefined, true, { big: "x".repeat(5000) }]) assert.equal(isCursor(cursor), false, String(cursor));
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.equal(isCursor(circular), false, "unserialisable cursors are refused, not thrown");
});

test("subscriptions: exactly one well-formed subscribe message", () => {
  assert.deepEqual(parseSubscription(JSON.stringify({ type: "subscribe", since: "42" })), { since: "42" });
  assert.deepEqual(parseSubscription(JSON.stringify({ type: "subscribe", since: 0 })), { since: 0 });
  for (const raw of [JSON.stringify({ type: "subscribe" }), JSON.stringify({ type: "subscribe", since: -1 }), JSON.stringify({ type: "SUBSCRIBE", since: 1 }), JSON.stringify({ type: "change", since: 1 }), "null", "[]", "1", "", "{", JSON.stringify({ type: "subscribe", since: "1", pad: "x".repeat(8200) })]) {
    assert.equal(parseSubscription(raw), null, raw.slice(0, 60));
  }
  assert.equal(parseSubscription(Buffer.from("{}") as unknown), null, "non-string input");
});

test("privacy: scouting documents keep match data and drop scout identity, notes, and unknown fields", () => {
  const projected = projectDashboardDocument("scouting_610_3", {
    _rev: "2-a", type: "scouting_data", team: 610, scoutName: "Alex", deviceId: "ipad-7",
    data: {
      teamNumber: 610, secretField: 1,
      start: { match: 3, alliance: "red", position: "r2", practice: false, scoutName: "Alex", scoutEmail: "a@example.com" },
      auto: { fuelScored: 4, fuelFed: 1, hangLevel: 1, markers: [{ x: 1, y: 2, type: "pickup" }], paths: ["M0,0"], fieldFlipped: true, notes: "private" },
      teleop: { fuelscored: 20, fuelpassed: 3, L2hang: 1, missedL3: 1, playedDefense: 1, breakDuration: 5, breakSeverity: "minor", general: "free-text note" },
      photo: "data:image/png;base64,AAAA",
    },
  });
  assert.deepEqual(projected, {
    _id: "scouting_610_3", _rev: "2-a", type: "scouting_data", team: 610,
    data: {
      teamNumber: 610,
      start: { match: 3, alliance: "red", position: "r2", practice: false },
      auto: { fuelScored: 4, fuelFed: 1, hangLevel: 1, markers: [{ x: 1, y: 2, type: "pickup" }], paths: ["M0,0"], fieldFlipped: true },
      teleop: { fuelscored: 20, fuelpassed: 3, L2hang: 1, missedL3: 1, playedDefense: 1, breakDuration: 5, breakSeverity: "minor" },
    },
  });
});

test("privacy: pit documents drop photos, notes, and interviewer details", () => {
  const projected = projectDashboardDocument("pit_610", { type: "pit", team: 610, data: { teamName: "Crescent Coyotes", drivetrainType: "swerve", robotPhoto: { content: "AAAA" }, notes: "private", redFlags: "private", interviewer: "Sam" } });
  assert.deepEqual(projected, { _id: "pit_610", type: "pit", team: 610, data: { teamName: "Crescent Coyotes", drivetrainType: "swerve" } });
});

test("privacy: report cards keep card facts and drop notes", () => {
  const projected = projectDashboardDocument("report_card_610_Q4", { type: "report_card", timestamp: "2027-03-01T00:00:00Z", data: { cardType: "Yellow", ruleViolation: "G204", matchNumber: 4, teamNumber: 610, notes: "private", reporter: "Sam" } });
  assert.deepEqual(projected, { _id: "report_card_610_Q4", type: "report_card", timestamp: "2027-03-01T00:00:00Z", match: 4, team: 610, data: { cardType: "Yellow", ruleViolation: "G204", matchNumber: 4, teamNumber: 610 } });
});

test("privacy: aggregate documents keep only known statistics", () => {
  const projected = projectDashboardDocument("aggregate_610", { type: "aggregate_data", team: 610, data: { standing: 1, matchesPlayed: 2, scoutNames: ["Alex"], comments: "private" } });
  assert.deepEqual(projected, { _id: "aggregate_610", type: "aggregate_data", team: 610, data: { standing: 1, matchesPlayed: 2 } });
});

test("privacy: a document whose type does not match its id is not relayed", () => {
  assert.equal(projectDashboardDocument("aggregate_1", { type: "pit", data: {} }), null);
  assert.equal(projectDashboardDocument("pit_1", { type: "aggregate_data", data: {} }), null);
  assert.equal(projectDashboardDocument("report_1_Q1", { data: {} }), null, "report without a type");
  assert.equal(projectDashboardDocument("scouting_1_1", { type: "user", data: {} }), null);
  assert.ok(projectDashboardDocument("scouting_1_1", { data: {} }), "older scouting docs had no type field");
});

test("privacy: oversized or overlong values are not relayed", () => {
  assert.equal(projectDashboardDocument("pit_1", { type: "pit", data: { teamName: "x".repeat(70_000) } }), null, "over the 64 KiB frame budget");
  const projected = projectDashboardDocument("pit_1", { type: "pit", timestamp: "x".repeat(65), team: { $ne: 1 }, data: {} });
  assert.deepEqual(projected, { _id: "pit_1", type: "pit", data: {} }, "overlong timestamps and object-valued team fields are dropped");
});

test("changes rows: deletions, channel removals, and tombstone docs become delete events", () => {
  assert.deepEqual(parseChangesFrame([
    { seq: 1, id: "pit_1", deleted: true, changes: [{ rev: "2-d" }] },
    { seq: 2, id: "pit_2", removed: ["channel"], changes: [{ rev: "3-r" }], doc: { type: "pit", data: { teamName: "leaked?" } } },
    { seq: 3, id: "pit_3", doc: { _id: "pit_3", _rev: "4-t", _deleted: true } },
  ]), [
    { type: "change", seq: 1, id: "pit_1", deleted: true, rev: "2-d" },
    { type: "change", seq: 2, id: "pit_2", deleted: true, rev: "3-r" },
    { type: "change", seq: 3, id: "pit_3", deleted: true, rev: "4-t" },
  ]);
});

test("changes rows: the leaf revision from `changes` wins over the body's _rev; invalid revisions are dropped", () => {
  const [withChanges] = parseChangesFrame([{ seq: 1, id: "pit_1", changes: [{ rev: "5-leaf" }], doc: { _rev: "4-old", type: "pit", data: {} } }]);
  assert.equal((withChanges as { rev?: string }).rev, "5-leaf");
  const [invalid] = parseChangesFrame([{ seq: 1, id: "pit_1", changes: [{ rev: "garbage" }], doc: { type: "pit", data: {} } }]);
  assert.equal((invalid as { rev?: string }).rev, undefined);
});

test("changes rows: accepts a JSON string and refuses non-arrays", () => {
  assert.equal(parseChangesFrame(JSON.stringify([{ seq: 1, id: "other" }])).length, 1);
  assert.deepEqual(parseChangesFrame("{"), []);
  assert.deepEqual(parseChangesFrame({ results: [] }), []);
  assert.deepEqual(parseChangesFrame(null), []);
});

test("server messages: the browser accepts only well-formed frames", () => {
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "error" })), { type: "error", retryable: true, resync: false });
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "error", retryable: false, resync: "yes" })), { type: "error", retryable: false, resync: false });
  assert.deepEqual(parseServerMessage(JSON.stringify({ type: "change", id: "pit_1", seq: 1, deleted: true, doc: { _id: "pit_1", data: { secret: 1 } } })), { type: "change", id: "pit_1", seq: 1, deleted: true }, "a delete never carries a document");
  for (const raw of [
    JSON.stringify({ type: "change", id: "pit_1", seq: 1, deleted: "false", doc: { _id: "pit_1" } }),
    JSON.stringify({ type: "change", id: "pit_1", seq: 1, deleted: false, rev: "bogus", doc: { _id: "pit_1" } }),
    JSON.stringify({ type: "change", id: "pit_1", seq: 1, deleted: false, doc: [] }),
    JSON.stringify({ type: "change", id: "pit_1", seq: 1, deleted: false }),
    JSON.stringify({ type: "cursor", seq: -1 }),
    JSON.stringify({ type: "hello" }),
    JSON.stringify({ type: "change", id: "pit_1", seq: 1, deleted: false, doc: { _id: "pit_1", pad: "x".repeat(140_000) } }),
  ]) assert.equal(parseServerMessage(raw), null, raw.slice(0, 80));
  assert.equal(parseServerMessage(42 as unknown), null);
});
