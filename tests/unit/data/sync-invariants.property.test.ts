// Property-based invariants of the client-side sync state. Each property is
// checked against a deliberately simple model (plain numeric maxima), not
// against the production comparison code. The seed comes from the bench
// (TEST_SEED), so any failure is reproducible with `--seed=<n>`.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { DocumentStore } from "../../../lib/realtime/documents.ts";
import { mergeAggregates, normalizeAggregateDocument } from "../../../lib/data/aggregates.ts";
import type { RealtimeChange } from "../../../lib/realtime/protocol.ts";

fc.configureGlobal({ seed: Number(process.env.TEST_SEED ?? 610), numRuns: 300 });

const ids = ["aggregate_1", "aggregate_2", "pit_1", "scouting_1_1"] as const;

/** One document's history: unique increasing generations, each either a write or a delete. */
const historyArb = fc.record({
  id: fc.constantFrom(...ids),
  length: fc.integer({ min: 1, max: 6 }),
  deletes: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  value: fc.integer({ min: 0, max: 50 }),
});
const eventsArb = fc.uniqueArray(historyArb, { selector: (history) => history.id, minLength: 1, maxLength: ids.length })
  .map((histories) => histories.flatMap(({ id, length, deletes, value }) => Array.from({ length }, (_, index): RealtimeChange => {
    // Feed revisions use even generations; REST copies (below) use odd ones, so the
    // two never tie (same-generation ordering is covered by the compareRevs tests).
    const generation = 2 * (index + 1);
    const deleted = deletes[index];
    const rev = `${generation}-${deleted ? "d" : "w"}${generation}`;
    return deleted
      ? { type: "change", id, rev, seq: 0, deleted: true }
      : { type: "change", id, rev, seq: 0, deleted: false, doc: { _id: id, _rev: rev, type: id.startsWith("aggregate") ? "aggregate_data" : "pit", team: 1, data: { standing: value + generation, matchesPlayed: generation } } };
  })));

/** Delivery: any order, with duplicates, each with a unique arrival sequence. */
const deliveryArb = eventsArb.chain((events) => fc.tuple(
  fc.constant(events),
  fc.shuffledSubarray([...events, ...events], { minLength: events.length * 2, maxLength: events.length * 2 }),
  fc.shuffledSubarray([...events, ...events.slice(0, 3)], { minLength: events.length + Math.min(3, events.length), maxLength: events.length + Math.min(3, events.length) }),
)).map(([events, first, second]) => ({
  events,
  first: first.map((event, index) => ({ ...event, seq: index + 1 })),
  second: second.map((event, index) => ({ ...event, seq: index + 1 })),
}));

const snapshot = (store: DocumentStore) => [...store.values()].map(({ id, rev, deleted, doc }) => ({ id, rev, deleted, doc })).sort((a, b) => a.id.localeCompare(b.id));
const generation = (rev?: string) => Number(rev?.split("-")[0]);

test("property: every client ends on each document's newest revision, whatever the order or duplication", () => {
  fc.assert(fc.property(deliveryArb, ({ events, first, second }) => {
    const a = new DocumentStore(); first.forEach((event) => a.apply(event));
    const b = new DocumentStore(); second.forEach((event) => b.apply(event));
    // Model: per id, the event with the highest generation.
    const newest = new Map<string, RealtimeChange>();
    for (const event of events) if (!newest.has(event.id) || generation(event.rev) > generation(newest.get(event.id)!.rev)) newest.set(event.id, event);
    for (const [id, expected] of newest) {
      assert.equal(a.get(id)?.rev, expected.rev, `${id} on client A`);
      assert.equal(a.get(id)?.deleted, expected.deleted);
    }
    assert.deepEqual(snapshot(a), snapshot(b), "clients converge");
  }));
});

test("property: applying the same delivery twice changes nothing the second time", () => {
  fc.assert(fc.property(deliveryArb, ({ first }) => {
    const store = new DocumentStore();
    first.forEach((event) => store.apply(event));
    const before = snapshot(store);
    const accepted = first.map((event) => store.apply(event));
    assert.deepEqual(accepted.filter(Boolean), [], "a replayed event is never reported as new");
    assert.deepEqual(snapshot(store), before);
  }));
});

test("property: events for one document never change another document", () => {
  fc.assert(fc.property(deliveryArb, ({ first }) => {
    const store = new DocumentStore();
    for (const event of first) {
      const others = snapshot(store).filter((entry) => entry.id !== event.id);
      store.apply(event);
      assert.deepEqual(snapshot(store).filter((entry) => entry.id !== event.id), others);
    }
  }));
});

test("property: REST merge shows exactly the newest live version of each document", () => {
  fc.assert(fc.property(deliveryArb, fc.array(fc.tuple(fc.constantFrom(...ids), fc.integer({ min: 0, max: 6 }).map((n) => 2 * n + 1)), { maxLength: 4 }), ({ first }, restRows) => {
    const store = new DocumentStore(); first.forEach((event) => store.apply(event));
    const rest = [...new Map(restRows.map(([id, gen]) => [id, { _id: id, _rev: `${gen}-r`, from: "rest" }])).values()];
    const merged = store.merge(rest, () => true);
    const byId = new Map(merged.map((doc) => [doc._id as string, doc]));
    assert.equal(byId.size, merged.length, "no duplicate documents");
    for (const id of ids) {
      const stored = store.get(id);
      const restDoc = rest.find((doc) => doc._id === id);
      const storeGen = stored ? generation(stored.rev) : -1;
      const restGen = restDoc ? generation(restDoc._rev) : -1;
      if (storeGen < 0 && restGen < 0) assert.equal(byId.has(id), false);
      else if (restGen > storeGen) assert.equal(byId.get(id)?.from, "rest", `${id}: newer REST copy wins`);
      else if (stored?.deleted) assert.equal(byId.has(id), false, `${id}: newest version is a deletion`);
      else assert.equal(byId.get(id)?._rev, stored!.rev, `${id}: newest feed copy wins`);
    }
  }));
});

test("property: aggregate lists do not depend on event order", () => {
  fc.assert(fc.property(deliveryArb, ({ first, second }) => {
    const a = new DocumentStore(); first.forEach((event) => a.apply(event));
    const b = new DocumentStore(); second.forEach((event) => b.apply(event));
    const view = (store: DocumentStore) => mergeAggregates([], store).map((team) => [team.sourceId, team.rank, team.matches]);
    assert.deepEqual(view(a), view(b));
  }));
});

const statValue = fc.oneof(fc.double(), fc.integer(), fc.string(), fc.constant(null), fc.boolean(), fc.object(), fc.array(fc.integer()));
const statKeys = ["standing", "matchesPlayed", "autoPPG", "teleopPPG", "endgamePPG", "fuelscored", "teleopFuelaccuracy", "autoFuelaccuracy", "avgDefenseSkill", "avgDriverSkill", "brokePercentage"];

test("property: any aggregate document yields finite statistics (never NaN or Infinity)", () => {
  fc.assert(fc.property(fc.dictionary(fc.constantFrom(...statKeys), statValue), (data) => {
    const row = normalizeAggregateDocument({ team: 610, data });
    if (Object.keys(data).length === 0) { assert.equal(row, null, "no statistics, no row"); return; }
    assert.ok(row);
    for (const key of ["rank", "matches", "autoPpg", "teleopPpg", "endgamePpg", "fuelPerMatch", "fuelAccuracy", "defenseRating", "driverSkill", "breakRate"] as const) {
      assert.ok(Number.isFinite(row[key]), `${key} = ${row[key]}`);
    }
  }));
});

test("property: valid percentages stay valid whole-number percentages; valid counts stay non-negative", () => {
  fc.assert(fc.property(
    fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), fc.nat(500), fc.double({ min: 0, max: 400, noNaN: true }),
    (accuracy, broke, matches, fuel) => {
      const row = normalizeAggregateDocument({ team: 1, data: { teleopFuelaccuracy: accuracy, brokePercentage: broke, matchesPlayed: matches, fuelscored: fuel } })!;
      for (const percent of [row.fuelAccuracy, row.breakRate]) assert.ok(Number.isInteger(percent) && percent >= 0 && percent <= 100, `percentage ${percent}`);
      assert.equal(row.matches, matches);
      assert.ok(row.fuelPerMatch >= 0);
    },
  ));
});
