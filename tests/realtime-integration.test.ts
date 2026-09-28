// End-to-end over real sockets: fake Sync Gateway -> long-poll -> bridge ->
// WebSocket upgrade handler -> RealtimeClient -> DocumentStore.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { after, before, beforeEach, test } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { RealtimeClient, type SocketLike } from "../lib/realtime-client.ts";
import { createRealtimeUpgradeHandler } from "../lib/realtime-server.ts";
import { getActiveRealtimeConnections } from "../lib/realtime-bridge.ts";
import { mergeAggregates } from "../lib/normalize-aggregate.ts";
import { FAKE_AUTH, FakeSyncGateway } from "./helpers/fake-sync-gateway.ts";

let gateway: FakeSyncGateway;
let server: Server;
let origin: string;
let refuseUpgrades = false;
const serverSockets = new Set<Duplex>();
const clients: RealtimeClient[] = [];

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 4000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function newClient(url = `${origin.replace("http", "ws")}/api/realtime`) {
  const client = new RealtimeClient({
    url: () => url,
    createSocket: (target) => new WebSocket(target, { origin }) as unknown as SocketLike,
    retryBaseMs: 20, retryMaxMs: 100,
  });
  clients.push(client);
  return client;
}

async function connected(client: RealtimeClient, cursor: unknown = gateway.lastSeq) {
  client.connect(String(cursor));
  await waitFor(() => client.getStatus() === "connected", "client connected");
}

const docData = (id: string, client: RealtimeClient) => client.store.get(id)?.doc?.data as Record<string, unknown> | undefined;

before(async () => {
  gateway = new FakeSyncGateway();
  const changesUrl = await gateway.start();
  const handleUpgrade = createRealtimeUpgradeHandler({ getConfig: () => ({ url: changesUrl, authorization: FAKE_AUTH }) });
  server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  server.on("upgrade", (request, socket, head) => {
    if (refuseUpgrades) { socket.destroy(); return; }
    serverSockets.add(socket); socket.on("close", () => serverSockets.delete(socket));
    if (!handleUpgrade(request, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { refuseUpgrades = false; });

after(async () => {
  clients.forEach((client) => client.disconnect());
  serverSockets.forEach((socket) => socket.destroy());
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await gateway.stop();
});

test("connects, subscribes from the page cursor, and reports ready", async () => {
  gateway.put("aggregate_610", { type: "aggregate_data", team: 610, data: { matchesPlayed: 1 } });
  const client = newClient();
  await connected(client);
  const subscribeRequest = gateway.requests.findLast((url) => url.searchParams.get("feed") === "normal");
  assert.equal(subscribeRequest?.searchParams.get("since"), String(gateway.lastSeq));
  client.disconnect();
});

test("new and updated scouting records reach every connected client", async () => {
  const first = newClient(); const second = newClient();
  await connected(first); await connected(second);

  gateway.put("scouting_610_12", { type: "scouting_data", team: 610, scoutName: "private", data: { start: { match: 12 }, teleop: { fuelscored: 4 } } });
  await waitFor(() => Boolean(first.store.get("scouting_610_12") && second.store.get("scouting_610_12")), "both clients received the new record");
  assert.deepEqual(docData("scouting_610_12", first), { start: { match: 12 }, teleop: { fuelscored: 4 } });
  assert.equal(first.store.get("scouting_610_12")?.doc?.scoutName, undefined, "private fields are not relayed");

  const updatedRev = gateway.put("scouting_610_12", { type: "scouting_data", team: 610, data: { start: { match: 12 }, teleop: { fuelscored: 9 } } });
  await waitFor(() => first.store.get("scouting_610_12")?.rev === updatedRev && second.store.get("scouting_610_12")?.rev === updatedRev, "both clients received the update");
  assert.deepEqual(docData("scouting_610_12", second), { start: { match: 12 }, teleop: { fuelscored: 9 } });
  assert.deepEqual([...first.store.values()].map((doc) => [doc.id, doc.rev]), [...second.store.values()].map((doc) => [doc.id, doc.rev]), "clients converge");
  first.disconnect(); second.disconnect();
});

test("Couchbase-originated aggregate, pit, and delete changes update derived dashboard data", async () => {
  const client = newClient();
  await connected(client);
  gateway.put("aggregate_1678", { type: "aggregate_data", team: 1678, data: { standing: 3, matchesPlayed: 5 } });
  gateway.put("pit_1678", { type: "pit", team: 1678, data: { teamName: "Citrus Circuits", redFlags: "private" } });
  gateway.put("report_1678_Q4", { type: "report_card", team: "1678", data: { cardType: "Yellow", notes: "private" } });
  gateway.put("event_schedule_cache", { type: "schedule" }); // unrelated document: cursor only
  await waitFor(() => Boolean(client.store.get("report_1678_Q4")), "report received");
  const teams = mergeAggregates([], client.store);
  assert.deepEqual(teams.map((team) => [team.team, team.matches, team.name]), [[1678, 5, "Citrus Circuits"]]);
  assert.equal(client.store.get("event_schedule_cache"), undefined);

  gateway.delete("report_1678_Q4");
  await waitFor(() => client.store.get("report_1678_Q4")?.deleted === true, "deletion received");
  assert.deepEqual(client.store.merge([{ _id: "report_1678_Q4", _rev: "1-00000000" }], (id) => id.startsWith("report_1678_")), [], "a stale snapshot copy of a deleted report is hidden");
  client.disconnect();
});

test("duplicate and stale upstream events do not change client state", async () => {
  const client = newClient();
  await connected(client);
  const rev1 = gateway.put("aggregate_254", { type: "aggregate_data", team: 254, data: { matchesPlayed: 1 } });
  const rev2 = gateway.put("aggregate_254", { type: "aggregate_data", team: 254, data: { matchesPlayed: 2 } });
  await waitFor(() => client.store.get("aggregate_254")?.rev === rev2, "latest revision received");
  const version = client.getVersion();

  const seq = gateway.lastSeq;
  gateway.inject([
    // exact replay of the latest event
    { seq, id: "aggregate_254", changes: [{ rev: rev2 }], doc: { _id: "aggregate_254", _rev: rev2, type: "aggregate_data", team: 254, data: { matchesPlayed: 2 } } },
    // an older revision arriving late
    { seq, id: "aggregate_254", changes: [{ rev: rev1 }], doc: { _id: "aggregate_254", _rev: rev1, type: "aggregate_data", team: 254, data: { matchesPlayed: 1 } } },
  ]);
  gateway.put("pit_254", { type: "pit", data: { teamName: "Cheesy Poofs" } }); // marker that the injected batch was processed
  await waitFor(() => Boolean(client.store.get("pit_254")), "marker received");
  assert.equal(client.getVersion(), version + 1, "only the marker counted as new information");
  assert.equal(client.store.get("aggregate_254")?.rev, rev2);
  assert.equal(docData("aggregate_254", client)?.matchesPlayed, 2);
  client.disconnect();
});

test("malformed upstream rows are skipped without breaking the connection", async () => {
  const client = newClient();
  await connected(client);
  gateway.inject([null, 42, "text", {}, { seq: "" }, { seq: -5, id: "pit_1" }, { seq: gateway.lastSeq, id: "scouting_1_1", doc: "not an object" }, { seq: gateway.lastSeq, id: "aggregate_1", doc: { type: "wrong" } }]);
  gateway.put("scouting_1_2", { type: "scouting_data", data: { start: { match: 2 } } });
  await waitFor(() => Boolean(client.store.get("scouting_1_2")), "valid change after malformed rows");
  assert.equal(client.store.get("scouting_1_1"), undefined);
  assert.equal(client.store.get("aggregate_1"), undefined);
  assert.equal(client.getStatus(), "connected");
  client.disconnect();
});

test("malformed client messages are rejected without affecting other clients", async () => {
  const healthy = newClient();
  await connected(healthy);
  const rogue = new WebSocket(`${origin.replace("http", "ws")}/api/realtime`, { origin });
  await new Promise((resolve) => rogue.once("open", resolve));
  const closed = new Promise<number>((resolve) => rogue.once("close", (code) => resolve(code)));
  rogue.send("{not json");
  assert.equal(await closed, 1008);

  const oversized = new WebSocket(`${origin.replace("http", "ws")}/api/realtime`, { origin });
  await new Promise((resolve) => oversized.once("open", resolve));
  const oversizedClosed = new Promise<number>((resolve) => oversized.once("close", (code) => resolve(code)));
  oversized.send("x".repeat(20_000));
  assert.equal(await oversizedClosed, 1009, "payloads over maxPayload are refused");

  gateway.put("pit_9999", { type: "pit", data: { teamName: "Still Working" } });
  await waitFor(() => Boolean(healthy.store.get("pit_9999")), "healthy client still receives changes");
  healthy.disconnect();
});

test("cross-origin upgrades are refused", async () => {
  const socket = new WebSocket(`${origin.replace("http", "ws")}/api/realtime`, { origin: "https://evil.example" });
  const status = await new Promise<number | undefined>((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    socket.once("open", () => resolve(undefined));
  });
  assert.equal(status, 403);
});

test("disconnecting releases the server connection and its upstream long-poll", async () => {
  await waitFor(() => getActiveRealtimeConnections() === 0, "earlier connections released");
  const client = newClient();
  await connected(client);
  await waitFor(() => gateway.openLongPolls > 0, "upstream long-poll open");
  assert.equal(getActiveRealtimeConnections(), 1);
  client.disconnect();
  assert.equal(client.getStatus(), "disconnected");
  await waitFor(() => getActiveRealtimeConnections() === 0, "server connection released");
  await waitFor(() => gateway.openLongPolls === 0, "upstream long-poll aborted");
});

test("reconnects after a dropped connection and receives every missed update", async () => {
  const client = newClient();
  await connected(client);
  gateway.put("scouting_33_1", { type: "scouting_data", data: { start: { match: 1 } } });
  await waitFor(() => Boolean(client.store.get("scouting_33_1")), "first record");
  const cursorBeforeDrop = client.getCursor();

  // Drop the network and keep the server unreachable while scouts keep submitting.
  refuseUpgrades = true;
  serverSockets.forEach((socket) => socket.destroy());
  await waitFor(() => client.getStatus() === "reconnecting", "client noticed the drop");
  gateway.put("scouting_33_2", { type: "scouting_data", data: { start: { match: 2 } } });
  const updatedRev = gateway.put("scouting_33_1", { type: "scouting_data", data: { start: { match: 1 }, teleop: { fuelscored: 7 } } });
  gateway.delete("aggregate_610");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(client.store.get("scouting_33_2"), undefined, "nothing arrives while offline");

  refuseUpgrades = false;
  await waitFor(() => client.getStatus() === "connected", "reconnected");
  await waitFor(() => Boolean(client.store.get("scouting_33_2")) && client.store.get("scouting_33_1")?.rev === updatedRev && client.store.get("aggregate_610")?.deleted === true, "missed updates replayed");
  const resumed = gateway.requests.filter((url) => url.searchParams.get("feed") === "normal").map((url) => url.searchParams.get("since"));
  assert.ok(resumed.includes(String(cursorBeforeDrop)), "resubscribed from the last applied cursor");
  client.disconnect();
});

test("recovers from a Sync Gateway outage with backoff", async () => {
  const client = newClient();
  gateway.fail(503, 3);
  client.connect(String(gateway.lastSeq));
  await waitFor(() => client.getStatus() === "connected", "connected after outage");
  gateway.put("pit_4414", { type: "pit", data: { teamName: "HighTide" } });
  await waitFor(() => Boolean(client.store.get("pit_4414")), "change after outage");
  client.disconnect();
});

test("an unusable cursor triggers a resync instead of a silent gap", async () => {
  const client = newClient();
  let resyncs = 0;
  client.subscribeResync(() => { resyncs += 1; });
  client.store.apply({ type: "change", id: "pit_1", seq: 1, deleted: false, rev: "1-a", doc: { _id: "pit_1" } });
  client.connect("not-a-sequence");
  await waitFor(() => resyncs === 1, "resync requested");
  assert.equal(client.getCursor(), undefined);
  assert.equal(client.store.get("pit_1"), undefined, "state derived from the old cursor is discarded");
  // The page supplies a fresh snapshot cursor and the client resumes.
  client.connect(String(gateway.lastSeq));
  await waitFor(() => client.getStatus() === "connected", "connected with fresh cursor", 6000);
  client.disconnect();
});

test("the client ignores malformed server messages and keeps its state", async () => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => wss.once("listening", resolve));
  wss.on("connection", (socket) => socket.once("message", () => {
    for (const junk of ["{", "[]", "null", JSON.stringify({ type: "change", id: "users_admin", seq: 1, deleted: false, doc: { _id: "users_admin" } }), JSON.stringify({ type: "change", id: "pit_1", seq: 2, deleted: false, doc: { _id: "pit_2" } })]) socket.send(junk);
    socket.send(JSON.stringify({ type: "ready" }));
    socket.send(JSON.stringify({ type: "change", id: "pit_1", seq: 3, deleted: false, rev: "1-a", doc: { _id: "pit_1", data: { teamName: "Valid" } } }));
  }));
  const client = newClient(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`);
  client.connect("1");
  await waitFor(() => Boolean(client.store.get("pit_1")), "valid message applied");
  assert.equal(client.getStatus(), "connected");
  assert.deepEqual([...client.store.values()].map((doc) => doc.id), ["pit_1"]);
  assert.equal(client.getCursor(), 3);
  client.disconnect();
  await new Promise((resolve) => wss.close(resolve));
});
