import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { attachRealtimeBridge, getActiveRealtimeConnections, isSameOriginUpgrade, type BridgeSocket, type FeedStarter } from "../../../lib/realtime-bridge.ts";
import { startCouchbaseLongPoll } from "../../../lib/couchbase-longpoll.ts";
import { compareRevs, isDashboardDocument, parseChangesFrame, parseServerMessage, parseSubscription, type RealtimeChange } from "../../../lib/realtime-protocol.ts";
import { DocumentStore } from "../../../lib/realtime-store.ts";
import { mergeAggregates, normalizeAggregateDocument } from "../../../lib/normalize-aggregate.ts";

class FakeSocket extends EventEmitter implements BridgeSocket {
  readyState = 1; sent: string[] = []; closed?: { code?: number; reason?: string };
  send(value: string) { this.sent.push(value); }
  close(code?: number, reason?: string) { if (this.readyState === 3) return; this.closed = { code, reason }; this.readyState = 3; this.emit("close"); }
  message(value: unknown) { this.emit("message", Buffer.from(typeof value === "string" ? value : JSON.stringify(value))); }
  frames() { return this.sent.map((value) => JSON.parse(value)); }
}
function makeClient(options: Parameters<typeof attachRealtimeBridge>[2] = {}, starter?: FeedStarter) {
  const client = new FakeSocket();
  let feed: { since: unknown; onFrame: Parameters<FeedStarter>[1]; onReady: () => void; onError: Parameters<FeedStarter>[3]; stopped: boolean } | undefined;
  attachRealtimeBridge(client, starter ?? ((since, onFrame, onReady, onError) => {
    feed = { since, onFrame, onReady, onError, stopped: false };
    return () => { if (feed) feed.stopped = true; };
  }), options);
  return { client, get feed() { return feed; } };
}
const change = (id: string, rev: string | undefined, seq: unknown, doc?: Record<string, unknown>, deleted = false): RealtimeChange =>
  ({ type: "change", id, seq, deleted, ...(rev ? { rev } : {}), ...(doc ? { doc: { _id: id, ...(rev ? { _rev: rev } : {}), ...doc } } : {}) });

// ---------------------------------------------------------------- server bridge

test("bridge: accepts a subscription, forwards readiness and frames, and stops the feed on disconnect", () => {
  const setup = makeClient(); setup.client.message({ type: "subscribe", since: "cursor-10" });
  assert.equal(setup.feed?.since, "cursor-10");
  setup.feed?.onReady();
  setup.feed?.onFrame({ type: "cursor", seq: 11 });
  assert.deepEqual(setup.client.frames(), [{ type: "ready" }, { type: "cursor", seq: 11 }]);
  setup.client.close(1000, "done");
  assert.equal(setup.feed?.stopped, true);
});

test("bridge: malformed subscriptions close the socket without starting a feed", () => {
  for (const bad of ["not json", { type: "subscribe" }, { type: "nope", since: 1 }, { type: "subscribe", since: -1 }, "x".repeat(9000)]) {
    const setup = makeClient(); setup.client.message(bad);
    assert.equal(setup.client.closed?.code, 1008, `expected 1008 for ${JSON.stringify(bad).slice(0, 40)}`);
    assert.equal(setup.feed, undefined);
  }
});

test("bridge: messages after the subscription are ignored", () => {
  const setup = makeClient(); setup.client.message({ type: "subscribe", since: 1 });
  setup.client.message("garbage"); setup.client.message({ type: "subscribe", since: 999 });
  assert.equal(setup.feed?.since, 1); assert.equal(setup.client.closed, undefined);
});

test("bridge: a subscription must arrive in time", async () => {
  const setup = makeClient({ subscriptionTimeoutMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(setup.client.closed?.code, 1008);
});

test("bridge: feed failures tell the client whether to resync, then close", () => {
  const retry = makeClient(); retry.client.message({ type: "subscribe", since: 1 });
  retry.feed?.onError(new Error("HTTP 500"));
  assert.deepEqual(retry.client.frames().at(-1), { type: "error", retryable: true, resync: false });
  assert.equal(retry.client.closed?.code, 1011);

  const resync = makeClient(); resync.client.message({ type: "subscribe", since: "bad" });
  resync.feed?.onError(Object.assign(new Error("HTTP 400"), { resync: true }));
  assert.deepEqual(resync.client.frames().at(-1), { type: "error", retryable: true, resync: true });
});

test("bridge: a feed that throws on start does not crash the server", () => {
  const setup = makeClient({}, () => { throw new Error("boom"); });
  setup.client.message({ type: "subscribe", since: 1 });
  assert.equal(setup.client.closed?.code, 1011);
});

test("bridge: long-lived connections are recycled with 1012 before a platform timeout", async () => {
  const setup = makeClient({ maxConnectionMs: 10 }); setup.client.message({ type: "subscribe", since: 1 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(setup.client.closed?.code, 1012); assert.equal(setup.feed?.stopped, true);
});

test("bridge: connection cap rejects extra sockets and frees slots on close", () => {
  const before = getActiveRealtimeConnections();
  const first = makeClient({ maxConnections: before + 1 });
  const second = makeClient({ maxConnections: before + 1 });
  assert.equal(second.client.closed?.code, 1013);
  first.client.close();
  assert.equal(getActiveRealtimeConnections(), before);
});

test("bridge: same-origin check", () => {
  assert.equal(isSameOriginUpgrade("http://localhost:3000", "localhost:3000"), true);
  assert.equal(isSameOriginUpgrade("https://scout.example", "scout.example"), true);
  assert.equal(isSameOriginUpgrade("https://evil.example", "scout.example"), false);
  assert.equal(isSameOriginUpgrade(undefined, "scout.example"), false);
  assert.equal(isSameOriginUpgrade("not a url", "scout.example"), false);
});

// ------------------------------------------------------------ upstream parsing

test("protocol: projects only dashboard fields and carries the revision", () => {
  const [event] = parseChangesFrame([{ seq: 1, id: "scouting_610_4", changes: [{ rev: "2-abc" }], doc: { _rev: "2-abc", type: "scouting_data", scoutName: "private", data: { start: { match: 4, scoutName: "private" }, auto: { fuelScored: 3, private: "secret" }, notes: "secret" } } }]);
  assert.deepEqual(event, { type: "change", seq: 1, id: "scouting_610_4", deleted: false, rev: "2-abc", doc: { _id: "scouting_610_4", _rev: "2-abc", type: "scouting_data", data: { start: { match: 4 }, auto: { fuelScored: 3 } } } });
});

test("protocol: pit team names are relayed so name changes reach the dashboard", () => {
  const [event] = parseChangesFrame([{ seq: 1, id: "pit_610", doc: { type: "pit", data: { teamName: "Crescent Coyotes", redFlags: "private" } } }]);
  assert.equal(event.type, "change");
  assert.deepEqual((event as RealtimeChange).doc?.data, { teamName: "Crescent Coyotes" });
});

test("protocol: malformed upstream rows are dropped, unrelated documents only advance the cursor", () => {
  assert.deepEqual(parseChangesFrame("{"), []);
  assert.deepEqual(parseChangesFrame({ not: "an array" }), []);
  assert.deepEqual(parseChangesFrame([{ seq: "", id: "scouting_610_4" }, null, {}, 7, { seq: 3, id: 5 }]), [{ type: "cursor", seq: 3 }]);
  assert.deepEqual(parseChangesFrame([{ seq: 2, id: "users_admin", doc: { type: "user" } }]), [{ type: "cursor", seq: 2 }]);
  // Wrong document type for the id prefix, or too large to relay.
  assert.deepEqual(parseChangesFrame([{ seq: 4, id: "aggregate_1", doc: { type: "something_else" } }]), [{ type: "cursor", seq: 4 }]);
  assert.deepEqual(parseChangesFrame([{ seq: 5, id: "scouting_610_4", doc: { data: { auto: { paths: ["x".repeat(70_000)] } } } }]), [{ type: "cursor", seq: 5 }]);
  // Invalid revision strings are not relayed.
  const [noRev] = parseChangesFrame([{ seq: 6, id: "pit_1", changes: [{ rev: "<script>" }], doc: { type: "pit", data: {} } }]);
  assert.equal((noRev as RealtimeChange).rev, undefined);
  assert.equal(isDashboardDocument("scouting_610_4"), true); assert.equal(isDashboardDocument("report_610_Qual 1"), true);
});

test("protocol: deletions and channel removals become delete events", () => {
  assert.deepEqual(parseChangesFrame([{ seq: 3, id: "pit_610", deleted: true, changes: [{ rev: "3-ff" }] }]), [{ type: "change", seq: 3, id: "pit_610", deleted: true, rev: "3-ff" }]);
  assert.equal((parseChangesFrame([{ seq: 4, id: "pit_610", removed: ["team"], doc: { _removed: true } }])[0] as RealtimeChange).deleted, true);
});

test("protocol: the browser rejects malformed server messages", () => {
  const valid = JSON.stringify({ type: "change", seq: 1, id: "pit_610", deleted: false, rev: "1-a", doc: { _id: "pit_610" } });
  assert.equal(parseServerMessage(valid)?.type, "change");
  for (const bad of [
    "not json", "null", "[]", JSON.stringify({ type: "mystery" }),
    JSON.stringify({ type: "change", seq: 1, id: "users_admin", deleted: false, doc: { _id: "users_admin" } }),
    JSON.stringify({ type: "change", seq: 1, id: "pit_610", deleted: false }),
    JSON.stringify({ type: "change", seq: 1, id: "pit_610", deleted: false, doc: { _id: "pit_999" } }),
    JSON.stringify({ type: "change", seq: 1, id: "pit_610", deleted: "yes" }),
    JSON.stringify({ type: "change", seq: 1, id: "pit_610", deleted: true, rev: 5 }),
    JSON.stringify({ type: "cursor", seq: -1 }),
  ]) assert.equal(parseServerMessage(bad), null, bad);
  assert.equal(parseServerMessage(42), null);
});

test("protocol: parses subscriptions and orders revisions like Couchbase", () => {
  assert.deepEqual(parseSubscription(JSON.stringify({ type: "subscribe", since: "40359:39664" })), { since: "40359:39664" });
  assert.equal(compareRevs("2-aaa", "10-aaa"), -1);
  assert.equal(compareRevs("3-bbb", "3-aaa"), 1);
  assert.equal(compareRevs("3-aaa", "3-aaa"), 0);
});

// -------------------------------------------------------------- client store

test("store: duplicate events are ignored", () => {
  const store = new DocumentStore();
  assert.equal(store.apply(change("scouting_610_4", "1-a", 23, { data: {} })), true);
  assert.equal(store.apply(change("scouting_610_4", "1-a", 23, { data: {} })), false);
  assert.equal(store.apply(change("scouting_610_5", "1-a", 23, { data: {} })), true);
});

test("store: stale and out-of-order revisions never replace newer data", () => {
  const store = new DocumentStore();
  store.apply(change("aggregate_610", "3-c", 30, { data: { matchesPlayed: 3 } }));
  assert.equal(store.apply(change("aggregate_610", "2-b", 20, { data: { matchesPlayed: 2 } })), false);
  assert.equal(store.get("aggregate_610")?.doc?.data && (store.get("aggregate_610")?.doc?.data as { matchesPlayed: number }).matchesPlayed, 3);
  // A late event for a document that was already deleted cannot resurrect it.
  store.apply(change("pit_610", "4-d", 40, undefined, true));
  assert.equal(store.apply(change("pit_610", "3-c", 35, { data: {} })), false);
  assert.equal(store.get("pit_610")?.deleted, true);
});

test("store: without revisions, only exact replays are recognised", () => {
  const store = new DocumentStore();
  assert.equal(store.apply(change("pit_1", undefined, 5, { data: {} })), true);
  assert.equal(store.apply(change("pit_1", undefined, 5, { data: {} })), false);
  assert.equal(store.apply(change("pit_1", undefined, 6, { data: {} })), true);
});

test("store: merging a REST snapshot keeps the newest version of each document", () => {
  const store = new DocumentStore();
  store.apply(change("scouting_610_1", "2-b", 10, { data: { v: "feed" } }));        // newer than snapshot
  store.apply(change("scouting_610_2", "1-a", 11, { data: { v: "feed-old" } }));    // older than snapshot
  store.apply(change("scouting_610_3", "2-x", 12, undefined, true));                 // deleted after snapshot
  store.apply(change("scouting_610_4", "1-n", 13, { data: { v: "created" } }));      // created after snapshot
  store.apply(change("scouting_999_1", "1-n", 14, { data: { v: "other team" } }));
  const snapshot = [
    { _id: "scouting_610_1", _rev: "1-a", data: { v: "snapshot" } },
    { _id: "scouting_610_2", _rev: "2-b", data: { v: "snapshot" } },
    { _id: "scouting_610_3", _rev: "1-a", data: { v: "snapshot" } },
  ];
  const merged = store.merge(snapshot, (id) => id.startsWith("scouting_610_"));
  assert.deepEqual(merged.map((doc) => [doc._id, (doc.data as { v: string }).v]), [
    ["scouting_610_1", "feed"], ["scouting_610_2", "snapshot"], ["scouting_610_4", "created"],
  ]);
});

test("aggregates: new teams, updates, deletes, and name changes merge into the server snapshot", () => {
  const initial = [
    normalizeAggregateDocument({ _id: "aggregate_610", _rev: "1-a", team: 610, data: { standing: 2, matchesPlayed: 1 } }, new Map([[610, "Coyotes"]])),
    normalizeAggregateDocument({ _id: "aggregate_254", _rev: "1-a", team: 254, data: { standing: 1, matchesPlayed: 1 } }),
  ].filter((team) => team !== null);
  const store = new DocumentStore();
  assert.equal(mergeAggregates(initial, store), initial, "unchanged snapshot is returned as-is");

  store.apply(change("aggregate_610", "2-b", 5, { type: "aggregate_data", team: 610, data: { standing: 1, matchesPlayed: 2 } }));
  store.apply(change("aggregate_1678", "1-a", 6, { type: "aggregate_data", team: 1678, data: { standing: 3, matchesPlayed: 1 } }));
  store.apply(change("aggregate_254", "2-z", 7, undefined, true));
  store.apply(change("pit_1678", "1-a", 8, { type: "pit", data: { teamName: "Citrus Circuits" } }));
  const merged = mergeAggregates(initial, store);
  assert.deepEqual(merged.map((team) => [team.team, team.matches, team.name]), [[610, 2, "Coyotes"], [1678, 1, "Citrus Circuits"]]);

  // A snapshot that is already newer than the feed wins.
  const newer = [normalizeAggregateDocument({ _id: "aggregate_610", _rev: "5-e", team: 610, data: { standing: 1, matchesPlayed: 9 } })].filter((team) => team !== null);
  assert.equal(mergeAggregates(newer, new DocumentStore()), newer);
  const storeWithOld = new DocumentStore(); storeWithOld.apply(change("aggregate_610", "2-b", 5, { type: "aggregate_data", team: 610, data: { matchesPlayed: 2 } }));
  assert.equal(mergeAggregates(newer, storeWithOld)[0].matches, 9);
});

// ------------------------------------------------------------ upstream feed

test("long-poll: verifies access, then long-polls from the last sequence and pages large backlogs", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  let stop = () => {};
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); requests.push(url);
    const payload = requests.length === 1
      ? { results: [], last_seq: "5" }
      : { results: [{ seq: 6, id: "scouting_610_7", changes: [{ rev: "1-a" }], doc: { type: "scouting_data", data: {} } }], last_seq: "6" };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try {
    const frames: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      stop = startCouchbaseLongPoll({ url: "https://sync.example/db/_changes", authorization: "Basic x" }, 4,
        (frame) => { frames.push(frame); if (frame.type === "change") { stop(); resolve(); } }, () => {}, reject);
    });
    assert.equal(requests[0].searchParams.get("feed"), "normal");
    assert.equal(requests[1].searchParams.get("feed"), "longpoll");
    assert.equal(requests[1].searchParams.get("since"), "5");
    assert.equal(requests[1].searchParams.get("limit"), "500");
  } finally { stop(); globalThis.fetch = originalFetch; }
});

test("long-poll: an HTTP 400 for the cursor asks the client to resync", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 400 });
  try {
    const error = await new Promise<Error & { resync?: boolean }>((resolve) => {
      startCouchbaseLongPoll({ url: "https://sync.example/db/_changes", authorization: "Basic x" }, "garbage", () => {}, () => {}, resolve);
    });
    assert.equal(error.resync, true);
  } finally { globalThis.fetch = originalFetch; }
});
