// The browser realtime client's connection state machine, driven with a
// scripted socket and mocked timers so every timeout and backoff step is exact.
// (tests/integration/realtime-sockets.test.ts covers the same client over real sockets.)
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { RealtimeClient, type RealtimeStatus, type SocketLike } from "../../../lib/realtime/client.ts";

type Listener = (event: unknown) => void;
class ScriptedSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closedWith?: { code: number; reason: string };
  private listeners: Record<string, Listener[]> = { open: [], message: [], close: [], error: [] };
  readonly url: string;
  constructor(url: string) { this.url = url; }
  addEventListener(type: string, listener: (event: never) => void) { this.listeners[type].push(listener as Listener); }
  send(data: string) { if (this.readyState !== 1) throw new Error("send on a socket that is not open"); this.sent.push(data); }
  close(code = 1000, reason = "") { if (this.readyState === 3) return; this.closedWith = { code, reason }; this.finish(code, reason, true); }
  // --- server side
  accept() { this.readyState = 1; this.listeners.open.forEach((listener) => listener(undefined)); }
  receive(message: unknown) { this.listeners.message.forEach((listener) => listener({ data: typeof message === "string" ? message : JSON.stringify(message) })); }
  drop(code = 1006) { this.listeners.error.forEach((listener) => listener(undefined)); this.finish(code, "", false); }
  private finish(code: number, reason: string, wasClean: boolean) { this.readyState = 3; this.listeners.close.forEach((listener) => listener({ code, reason, wasClean })); }
}

let sockets: ScriptedSocket[];
let statuses: RealtimeStatus[];
let client: RealtimeClient;
let failCreate = 0;

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout"] });
  mock.method(Math, "random", () => 0);
  sockets = []; statuses = []; failCreate = 0;
  client = new RealtimeClient({
    url: () => "ws://dashboard.test/api/realtime",
    createSocket: (url) => {
      if (failCreate > 0) { failCreate -= 1; throw new Error("blocked by the browser"); }
      const socket = new ScriptedSocket(url); sockets.push(socket); return socket;
    },
    // The defaults: 15 s handshake, 20 s ready, 75 s idle, 500 ms base / 30 s max backoff.
  });
  client.subscribeStatus((status) => statuses.push(status));
  mock.method(console, "warn", () => {});
});

afterEach(() => { client.disconnect(); mock.timers.reset(); mock.restoreAll(); });

const last = () => sockets.at(-1)!;
function ready(socket = last()) { socket.accept(); socket.receive({ type: "ready" }); }
const change = (id: string, rev: string, seq: number) => ({ type: "change", id, rev, seq, deleted: false, doc: { _id: id, _rev: rev, type: "pit", data: {} } });

test("client: does nothing without a cursor, and a second connect keeps the first stream and cursor", () => {
  client.connect(undefined);
  assert.equal(sockets.length, 0);
  client.connect("5");
  client.connect("9");
  assert.equal(sockets.length, 1);
  last().accept();
  assert.deepEqual(JSON.parse(last().sent[0]), { type: "subscribe", since: "5" });
  assert.equal(client.getCursor(), "5");
});

test("client: status goes connecting -> connected only after the server says ready", () => {
  client.connect("1");
  last().accept();
  assert.equal(client.getStatus(), "connecting");
  last().receive({ type: "ready" });
  assert.equal(client.getStatus(), "connected");
  assert.deepEqual(statuses, ["disconnected", "connecting", "connected"]);
});

test("client: new information notifies listeners once; duplicates do not; the cursor follows every frame", () => {
  client.connect("1"); ready();
  let notified = 0; client.subscribe(() => { notified += 1; });
  last().receive(change("pit_1", "1-a", 2));
  last().receive(change("pit_1", "1-a", 3));
  last().receive({ type: "cursor", seq: "4" });
  assert.equal(notified, 1);
  assert.equal(client.getVersion(), 1);
  assert.equal(client.getCursor(), "4");
});

test("client: malformed frames change nothing, including the cursor", () => {
  client.connect("1"); ready();
  for (const junk of ["{", "null", JSON.stringify({ type: "change", id: "admin", seq: 9, deleted: false, doc: { _id: "admin" } }), JSON.stringify({ type: "cursor", seq: -1 })]) last().receive(junk);
  assert.equal(client.getCursor(), "1");
  assert.equal(client.getVersion(), 0);
});

test("client: a handshake that never completes is abandoned after 15 s, then retried with backoff", () => {
  client.connect("1");
  mock.timers.tick(14_999);
  assert.equal(last().closedWith, undefined);
  mock.timers.tick(1);
  assert.equal(last().closedWith?.code, 4000);
  assert.equal(client.getStatus(), "reconnecting");
  mock.timers.tick(999);
  assert.equal(sockets.length, 1, "first retry waits 500 ms * 2^1");
  mock.timers.tick(1);
  assert.equal(sockets.length, 2);
});

test("client: a server that accepts but never becomes ready is abandoned after 20 s", () => {
  client.connect("1");
  last().accept();
  mock.timers.tick(20_000);
  assert.equal(last().closedWith?.code, 4001);
});

test("client: a feed that goes quiet for 75 s is treated as dead; any valid frame keeps it alive", () => {
  client.connect("1"); ready();
  mock.timers.tick(60_000);
  last().receive({ type: "cursor", seq: "2" });
  mock.timers.tick(60_000);
  assert.equal(last().closedWith, undefined);
  mock.timers.tick(15_000);
  assert.equal(last().closedWith?.code, 4002);
});

test("client: consecutive failures back off exponentially up to 30 s", () => {
  client.connect("1");
  const gaps: number[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    last().drop();
    const before = sockets.length;
    let waited = 0;
    while (sockets.length === before) { mock.timers.tick(100); waited += 100; }
    gaps.push(waited);
  }
  assert.deepEqual(gaps, [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
});

test("client: a successful connection resets the backoff", () => {
  client.connect("1");
  last().drop(); mock.timers.tick(1000);
  last().drop(); mock.timers.tick(2000);
  ready();
  last().drop();
  mock.timers.tick(999); assert.equal(sockets.length, 3);
  mock.timers.tick(1); assert.equal(sockets.length, 4, "back to the first backoff step");
});

test("client: a planned server restart (1012) reconnects immediately without counting as a failure", () => {
  client.connect("1"); ready();
  last().receive({ type: "cursor", seq: "7" });
  last().drop(1012);
  mock.timers.tick(0);
  assert.equal(sockets.length, 2);
  last().accept();
  assert.deepEqual(JSON.parse(last().sent[0]), { type: "subscribe", since: "7" }, "resumes from the last applied cursor");
});

test("client: an unusable cursor clears feed-derived state, asks the page to resync, and waits for a new cursor", () => {
  client.connect("1"); ready();
  last().receive(change("pit_1", "1-a", 2));
  let resyncs = 0; client.subscribeResync(() => { resyncs += 1; });
  last().receive({ type: "error", retryable: true, resync: true });
  last().drop(1011);
  assert.equal(resyncs, 1);
  assert.equal(client.getCursor(), undefined);
  assert.equal(client.store.get("pit_1"), undefined);
  mock.timers.tick(120_000);
  assert.equal(sockets.length, 1, "no reconnect loop on a cursor the server rejects");
  client.connect("100");
  assert.equal(sockets.length, 1, "the fresh cursor is still subject to backoff");
  mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  last().accept();
  assert.deepEqual(JSON.parse(last().sent[0]), { type: "subscribe", since: "100" });
});

test("client: disconnect closes cleanly, cancels pending retries, and forgets the cursor", () => {
  client.connect("1");
  last().drop();
  client.disconnect();
  mock.timers.tick(60_000);
  assert.equal(sockets.length, 1);
  assert.equal(client.getStatus(), "disconnected");
  client.connect("50");
  mock.timers.tick(1000); // the earlier failure still counts toward backoff
  assert.equal(sockets.length, 2);
  last().accept();
  assert.deepEqual(JSON.parse(last().sent[0]), { type: "subscribe", since: "50" });
  client.disconnect();
  assert.equal(sockets[1].closedWith?.code, 1000);
});

test("client: retryNow skips the backoff only when a retry is pending", () => {
  client.connect("1");
  client.retryNow();
  assert.equal(sockets.length, 1, "no-op while connected or connecting");
  last().drop();
  client.retryNow();
  assert.equal(sockets.length, 2);
});

test("client: a socket constructor that throws is retried with backoff instead of crashing the page", () => {
  failCreate = 2;
  client.connect("1");
  assert.equal(client.getStatus(), "reconnecting");
  mock.timers.tick(1000);
  mock.timers.tick(2000);
  assert.equal(sockets.length, 1);
  ready();
  assert.equal(client.getStatus(), "connected");
});

test("client: frames from a replaced socket are ignored", () => {
  client.connect("1"); ready();
  const old = last();
  old.drop();
  mock.timers.tick(1000);
  ready();
  old.receive(change("pit_9", "1-a", 99));
  assert.equal(client.store.get("pit_9"), undefined);
  assert.equal(client.getCursor(), "1");
});
