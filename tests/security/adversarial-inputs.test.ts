// Hostile and garbage input at every boundary: Sync Gateway rows, WebSocket
// messages in both directions, and REST query strings. Everything must fail
// safely: no exceptions, no crashes, no leaked fields, no effect on other clients.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fc from "fast-check";
import WebSocket from "ws";
import { GET } from "../../app/api/dashboard-documents/route.ts";
import { parseChangesFrame, parseServerMessage, parseSubscription, projectDashboardDocument } from "../../lib/realtime/protocol.ts";
import { DocumentStore } from "../../lib/realtime/documents.ts";
import { useGatewayForApp } from "../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { startRealtimeHarness, type RealtimeHarness } from "../helpers/realtime-harness.ts";
import { waitFor } from "../helpers/wait.ts";
import { asUser } from "../helpers/auth.ts";

fc.configureGlobal({ seed: Number(process.env.TEST_SEED ?? 610), numRuns: 400 });

let target: GatewayTarget;
let realtime: RealtimeHarness;
before(async () => { target = await startGatewayTarget(); useGatewayForApp(target); realtime = await startRealtimeHarness(target, { maxConnections: 40 }); });
after(async () => { await realtime.stop(); await target.stop(); });

const dashboardId = fc.oneof(
  fc.nat(99999).map((team) => `aggregate_${team}`), fc.nat(99999).map((team) => `pit_${team}`),
  fc.tuple(fc.nat(99999), fc.nat(200)).map(([team, match]) => `scouting_${team}_${match}`),
  fc.tuple(fc.nat(99999), fc.stringMatching(/^[A-Za-z0-9 ._-]{1,20}$/)).map(([team, key]) => `report_${team}_${key}`),
);
const hostileValue = fc.oneof(fc.anything(), fc.string({ unit: "grapheme", maxLength: 200 }), fc.constant("__proto__"), fc.constant({ __proto__: { polluted: true } }), fc.constant(JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}')));
const hostileDoc = fc.record({ type: fc.constantFrom("aggregate_data", "pit", "scouting_data", "report_card", undefined, "x"), team: hostileValue, timestamp: hostileValue, data: fc.oneof(hostileValue, fc.dictionary(fc.string(), hostileValue)), _rev: hostileValue }, { requiredKeys: [] });

/** Every key a projected document may contain, by level. */
const allowedTopLevel = new Set(["_id", "_rev", "timestamp", "team", "teamNumber", "type", "data", "match"]);

test("fuzz: the changes parser never throws and only relays allow-listed fields", () => {
  fc.assert(fc.property(fc.array(fc.oneof(fc.anything(), fc.record({ seq: fc.oneof(fc.nat(), fc.string(), fc.anything()), id: fc.oneof(dashboardId, fc.string()), doc: hostileDoc, deleted: fc.anything(), removed: fc.anything(), changes: fc.anything() }, { requiredKeys: [] })), { maxLength: 20 }), (rows) => {
    const frames = parseChangesFrame(rows);
    for (const frame of frames) {
      if (frame.type !== "change" || !frame.doc) continue;
      for (const key of Object.keys(frame.doc)) assert.ok(allowedTopLevel.has(key), `unexpected top-level key ${key}`);
      assert.ok(JSON.stringify(frame.doc).length <= 64 * 1024);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined, "Object.prototype was not polluted");
  }));
});

test("fuzz: the browser never throws on arbitrary server messages and never stores an invalid change", () => {
  fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 500 }), fc.anything().map((value) => { try { return JSON.stringify(value) ?? "null"; } catch { return "null"; } }), fc.record({ type: fc.constantFrom("change", "cursor", "ready", "error", "CHANGE", ""), id: fc.oneof(dashboardId, fc.string()), seq: fc.anything(), deleted: fc.anything(), rev: fc.anything(), doc: fc.anything() }, { requiredKeys: [] }).map((value) => JSON.stringify(value) ?? "null")), (raw) => {
    const message = parseServerMessage(raw);
    if (message?.type === "change") {
      const store = new DocumentStore();
      store.apply(message);
      assert.ok(message.deleted || (message.doc && message.doc._id === message.id));
    }
  }));
});

test("fuzz: subscriptions accept only a valid cursor; everything else is refused without throwing", () => {
  fc.assert(fc.property(fc.oneof(fc.string({ unit: "binary", maxLength: 9000 }), fc.anything().map((value) => { try { return JSON.stringify({ type: "subscribe", since: value }); } catch { return ""; } })), (raw) => {
    const parsed = parseSubscription(raw);
    if (parsed) assert.ok(raw.length <= 8192);
  }));
});

test("fuzz: document projection never throws and never grows beyond the frame budget", () => {
  fc.assert(fc.property(dashboardId, hostileDoc, (id, doc) => {
    const projected = projectDashboardDocument(id, doc as Record<string, unknown>);
    if (projected) {
      assert.equal(projected._id, id);
      assert.ok(JSON.stringify(projected).length <= 64 * 1024);
    }
  }));
});

test("deep nesting and huge values are dropped instead of crashing the feed", () => {
  const deep = JSON.parse(`{"markers":${"[".repeat(50_000)}${"]".repeat(50_000)}}`);
  assert.doesNotThrow(() => parseChangesFrame([{ seq: 1, id: "scouting_1_1", doc: { type: "scouting_data", data: { auto: deep } } }]));
  const huge = parseChangesFrame([{ seq: 2, id: "pit_1", doc: { type: "pit", data: { teamName: "x".repeat(5_000_000) } } }]);
  assert.deepEqual(huge, [{ type: "cursor", seq: 2 }], "an oversized document advances the cursor but is not relayed");
  const manyRows = Array.from({ length: 50_000 }, (_, index) => ({ seq: index + 1, id: `scouting_1_${index}`, doc: { type: "scouting_data", data: {} } }));
  const started = performance.now();
  assert.equal(parseChangesFrame(manyRows).length, 50_000);
  assert.ok(performance.now() - started < 5000, "a very large batch is parsed in reasonable time");
});

test("unicode, invalid numbers, negatives, and huge numbers survive end to end without corruption", async () => {
  const client = await realtime.connected(await target.lastSeq());
  const name = "Équipe 🤖 ‮RTL‬ ‍zero-width 日本語";
  await target.upsert("pit_8801", { type: "pit", data: { teamName: name } });
  await target.upsert("aggregate_8801", { type: "aggregate_data", data: { standing: -3, matchesPlayed: 1e308, autoPPG: -0.5, fuelscored: 1.7976931348623157e308 } });
  await waitFor(() => client.store.get("aggregate_8801") && client.store.get("pit_8801"), "delivered");
  assert.equal((client.store.get("pit_8801")?.doc?.data as { teamName: string }).teamName, name, "names are relayed byte for byte");
  assert.deepEqual(client.store.get("aggregate_8801")?.doc?.data, { standing: -3, matchesPlayed: 1e308, autoPPG: -0.5, fuelscored: 1.7976931348623157e308 });
  client.disconnect();
});

test("duplicate ids in one upstream batch: the newest revision wins regardless of position", () => {
  const store = new DocumentStore();
  const frames = parseChangesFrame([
    { seq: 3, id: "pit_2", changes: [{ rev: "3-c" }], doc: { type: "pit", data: { teamName: "three" } } },
    { seq: 1, id: "pit_2", changes: [{ rev: "1-a" }], doc: { type: "pit", data: { teamName: "one" } } },
    { seq: 2, id: "pit_2", changes: [{ rev: "2-b" }], deleted: true },
  ]);
  for (const frame of frames) if (frame.type === "change") store.apply(frame);
  assert.equal(store.get("pit_2")?.rev, "3-c");
  assert.equal((store.get("pit_2")?.doc?.data as { teamName: string }).teamName, "three");
});

test("fuzz: REST query strings only ever produce 200 or 400 with a JSON body", async () => {
  await fc.assert(fc.asyncProperty(
    fc.oneof(fc.string({ unit: "binary", maxLength: 300 }), fc.tuple(fc.oneof(fc.constantFrom("matches", "pit", "reports"), fc.string()), fc.oneof(fc.integer().map(String), fc.double().map(String), fc.string())).map(([kind, team]) => `kind=${encodeURIComponent(kind)}&team=${encodeURIComponent(team)}`)),
    async (query) => {
      let url: URL;
      try { url = new URL(`http://dashboard.test/api/dashboard-documents?${query}`); } catch { return; }
      const response = await GET(asUser(realtime.member, url.toString()));
      assert.ok(response.status === 200 || response.status === 400, `status ${response.status} for ${query}`);
      JSON.parse(await response.text());
    },
  ), { numRuns: 150 });
});

test("malformed WebSocket traffic from one client never affects another", async () => {
  const healthy = await realtime.connected(await target.lastSeq());
  const hostile: Array<string | Buffer> = [
    Buffer.from([0xff, 0xfe, 0x00]), "", "null", "[]", JSON.stringify({ type: "subscribe", since: { $gt: "" }, extra: "x".repeat(7000) }),
    JSON.stringify({ type: "subscribe", since: "0&filter=sync_gateway/bychannel&channels=admin" }),
    `{"type":"subscribe","since":${"[".repeat(3000)}${"]".repeat(3000)}}`,
    JSON.stringify({ type: "change", id: "pit_1", seq: 1, deleted: false, doc: { _id: "pit_1" } }),
    JSON.stringify({ type: "unknown-event" }),
  ];
  const outcomes = await Promise.all(hostile.map((payload) => new Promise<number>((resolve) => {
    const socket = new WebSocket(realtime.wsUrl, realtime.socketOptions());
    socket.on("open", () => socket.send(payload));
    socket.on("message", () => {}); // a subscription that parses gets data like any client; closing is what we check
    socket.on("close", (code) => resolve(code));
    socket.on("error", () => {});
    setTimeout(() => socket.close(), 1500);
  })));
  for (const [index, code] of outcomes.entries()) assert.ok([1000, 1005, 1008, 1009, 1011].includes(code), `payload ${index} closed with ${code}`);
  await target.upsert("pit_8802", { type: "pit", data: { teamName: "still flowing" } });
  await waitFor(() => healthy.store.get("pit_8802"), "healthy client unaffected");
  assert.equal(healthy.getStatus(), "connected");
  healthy.disconnect();
});

test("a subscription cursor cannot inject parameters into the upstream request", async () => {
  const fake = target.fake;
  assert.ok(fake, "inspects upstream requests");
  const injected = "0&filter=sync_gateway/bychannel&channels=admin&include_docs=false";
  const socket = new WebSocket(realtime.wsUrl, realtime.socketOptions());
  await new Promise((resolve) => socket.on("open", resolve));
  const before = fake.requests.length;
  socket.send(JSON.stringify({ type: "subscribe", since: injected }));
  await waitFor(() => fake.requests.length > before, "upstream request made");
  const request = fake.requests[before];
  assert.equal(request.searchParams.get("since"), injected, "the whole cursor stays one encoded value");
  assert.equal(request.searchParams.get("filter"), null);
  assert.equal(request.searchParams.get("channels"), null);
  assert.equal(request.searchParams.get("include_docs"), "true");
  assert.equal(request.pathname, `/${target.database}/_changes`);
  socket.close();
});

test("connection floods are capped and slots are released", async () => {
  const sockets = Array.from({ length: 60 }, () => new WebSocket(realtime.wsUrl, realtime.socketOptions()));
  const codes = await Promise.all(sockets.map((socket) => new Promise<number | "open">((resolve) => {
    socket.on("close", (code) => resolve(code));
    socket.on("error", () => {});
    setTimeout(() => resolve("open"), 1500);
  })));
  assert.ok(codes.filter((code) => code === 1013).length >= 20, `over-cap connections are refused with 1013 (${codes.filter((code) => code === 1013).length})`);
  sockets.forEach((socket) => socket.terminate());
  const after = await realtime.connected(await target.lastSeq());
  assert.equal(after.getStatus(), "connected", "capacity returns after the flood");
  after.disconnect();
});
