// Realtime connections are bound to a session: the upgrade decision for every
// kind of authentication result, periodic re-validation (revoked → closed with
// 4401, account store down → kept open), and the per-connection metrics.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { beforeEach, mock, test } from "node:test";
import { attachRealtimeBridge, type BridgeSocket } from "../../../lib/realtime/bridge.ts";
import { SESSION_ENDED } from "../../../lib/realtime/protocol.ts";
import { sessionBridgeOptions, upgradeDecision } from "../../../lib/realtime/server.ts";
import type { Authentication } from "../../../lib/auth/requests.ts";
import type { Viewer } from "../../../lib/auth/sessions.ts";
import { metricsSnapshot, resetMetrics } from "../../../lib/ops/metrics.ts";

class FakeSocket extends EventEmitter implements BridgeSocket {
  readyState = 1; sent: string[] = []; closed?: number; failSends = false;
  send(value: string) { if (this.failSends) throw new Error("socket buffer full"); this.sent.push(value); }
  close(code?: number) { if (this.readyState === 3) return; this.closed = code; this.readyState = 3; this.emit("close", code); }
  message(value: unknown) { this.emit("message", Buffer.from(JSON.stringify(value))); }
}

const viewer = (role: Viewer["principal"]["role"], status: Viewer["principal"]["status"] = "active") => ({ userId: "u0123456789abcdef0123", principal: { id: "u0123456789abcdef0123", role, status } }) as Viewer;
const signedIn = (role: Viewer["principal"]["role"], status: Viewer["principal"]["status"] = "active"): Authentication => ({ status: "signed-in", viewer: viewer(role, status) });

beforeEach(() => resetMetrics());

test("upgrade decision: signed out 401, store down 503, denied 403, any active role accepted", () => {
  assert.deepEqual(upgradeDecision({ status: "signed-out", reason: "expired" }), { ok: false, status: 401, reason: "auth" });
  assert.deepEqual(upgradeDecision({ status: "unavailable", reason: "down" }), { ok: false, status: 503, reason: "unconfigured" });
  assert.deepEqual(upgradeDecision(signedIn("SCOUT", "disabled")), { ok: false, status: 403, reason: "auth" });
  for (const role of ["MEMBER", "SCOUT", "SCOUT_LEAD", "MENTOR", "OWNER"] as const) assert.equal(upgradeDecision(signedIn(role)).ok, true, role);
});

test("re-validation: a revoked session closes the socket with 4401 and stops the feed; a store outage keeps it open", async () => {
  mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  try {
    const answers: Array<Authentication | Error> = [signedIn("SCOUT"), new Error("store down"), { status: "signed-out", reason: "unknown" }];
    let stopped = false;
    const client = new FakeSocket();
    attachRealtimeBridge(client, () => () => { stopped = true; }, {
      revalidateMs: 1000,
      ...sessionBridgeOptions(viewer("SCOUT"), async () => {
        const next = answers.shift()!;
        if (next instanceof Error) return { status: "unavailable", reason: next.message };
        return next;
      }),
    });
    client.message({ type: "subscribe", since: "5" });
    for (const expectedOpen of [true, true]) {
      mock.timers.tick(1000);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(client.closed === undefined, expectedOpen);
    }
    mock.timers.tick(1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.closed, SESSION_ENDED);
    assert.equal(stopped, true, "the upstream long-poll is stopped too");
    const snapshot = metricsSnapshot();
    assert.equal(snapshot.realtime.sessionEnded, 1);
    assert.equal(snapshot.realtime.activeConnections, 0);
    assert.ok(snapshot.realtime.events.some((event) => event.type === "disconnected" && event.detail === `code ${SESSION_ENDED}`));
  } finally { mock.timers.reset(); }
});

test("metrics: identity, frames, send failures, and feed errors are recorded per connection", () => {
  const client = new FakeSocket();
  let feed: { onFrame: (frame: never) => void; onReady: () => void; onError: (error: Error & { resync?: boolean }) => void } | undefined;
  attachRealtimeBridge(client, (_since, onFrame, onReady, onError) => { feed = { onFrame, onReady, onError }; return () => {}; }, sessionBridgeOptions(viewer("MENTOR"), async () => signedIn("MENTOR")));
  client.message({ type: "subscribe", since: "9" });
  feed!.onReady();
  feed!.onFrame({ type: "change", seq: 10, id: "pit_1", deleted: false, doc: { _id: "pit_1" } } as never);
  let snapshot = metricsSnapshot();
  assert.deepEqual({ id: snapshot.realtime.connections[0].userId, role: snapshot.realtime.connections[0].role, since: snapshot.realtime.connections[0].since, changes: snapshot.realtime.changesSent, last: snapshot.realtime.lastChangeId, seq: snapshot.realtime.lastSeq },
    { id: "u0123456789abcdef0123", role: "MENTOR", since: "9", changes: 1, last: "pit_1", seq: "10" });
  client.failSends = true;
  feed!.onFrame({ type: "cursor", seq: 11 } as never);
  assert.equal(metricsSnapshot().realtime.sendErrors, 1);
  client.failSends = false;
  feed!.onError(Object.assign(new Error("Sync Gateway changes feed returned HTTP 400"), { resync: true }));
  snapshot = metricsSnapshot();
  assert.deepEqual({ feedErrors: snapshot.realtime.feedErrors, resyncs: snapshot.realtime.resyncs, closed: client.closed }, { feedErrors: 1, resyncs: 1, closed: 1011 });
  assert.ok(snapshot.errors.some((entry) => entry.source === "realtime-feed"));
});
