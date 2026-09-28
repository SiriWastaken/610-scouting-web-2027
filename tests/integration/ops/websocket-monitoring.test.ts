// The admin panel's WebSocket numbers against actual connections: several
// real clients, real changes, refusals, malformed traffic, and a session
// revoked while its socket is open.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import WebSocket from "ws";
import * as overview from "../../../app/api/admin/overview/route.ts";
import { authRuntime } from "../../../lib/auth/requests.ts";
import { revokeUserSessions } from "../../../lib/auth/sessions.ts";
import { metricsSnapshot, resetMetrics } from "../../../lib/ops/metrics.ts";
import { useGatewayForApp } from "../../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../../helpers/gateway-target.ts";
import { startRealtimeHarness, type RealtimeHarness } from "../../helpers/realtime-harness.ts";
import { asUser } from "../../helpers/auth.ts";
import { waitFor } from "../../helpers/wait.ts";

let target: GatewayTarget;
let realtime: RealtimeHarness;

before(async () => {
  target = await startGatewayTarget();
  useGatewayForApp(target);
  realtime = await startRealtimeHarness(target, { revalidateMs: 200 });
});
beforeEach(async () => { await waitFor(() => metricsSnapshot().realtime.activeConnections === 0, "previous test's sockets closed"); resetMetrics(); realtime.auth.apply(); });
after(async () => { await realtime.stop(); await target.stop(); });

const upgrade = (headers: { origin?: string; cookie?: string }) => new Promise<number>((resolve) => {
  const socket = new WebSocket(realtime.wsUrl, { ...(headers.origin ? { origin: headers.origin } : {}), headers: headers.cookie ? { cookie: headers.cookie } : {} });
  socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
  socket.once("open", () => { socket.close(); resolve(101); });
  socket.once("error", () => {});
});

test("three clients: active count, per-connection frames, delivered changes, and the admin API agree", async () => {
  const since = await target.lastSeq();
  const clients = await Promise.all([1, 2, 3].map(() => realtime.connected(since)));
  let snapshot = metricsSnapshot();
  assert.equal(snapshot.realtime.activeConnections, 3);
  assert.equal(snapshot.realtime.opened, 3);
  assert.ok(snapshot.realtime.connections.every((connection) => connection.userId === realtime.member.userId && connection.role === "MEMBER"));
  await target.upsert("pit_4401", { type: "pit", data: { teamName: "Monitored" } });
  await waitFor(() => clients.every((client) => client.store.get("pit_4401")), "all three received it");
  snapshot = metricsSnapshot();
  assert.equal(snapshot.realtime.changesSent, 3, "one delivery per connected client");
  assert.equal(snapshot.realtime.lastChangeId, "pit_4401");
  assert.ok(snapshot.realtime.connections.every((connection) => connection.changesSent === 1));
  assert.ok(snapshot.upstream.uniqueChanges >= 1, "the database change is counted once, not once per client");
  assert.ok(snapshot.realtime.events.some((event) => event.type === "change-delivered" && event.detail?.startsWith("pit_4401")));

  const admin = await realtime.auth.user("MENTOR");
  const api = await (await overview.GET(asUser(admin, "http://dashboard.test/api/admin/overview"))).json() as { checks: { realtime: { status: string } }; metrics: { realtime: { activeConnections: number; changesSent: number } } };
  assert.equal(api.metrics.realtime.activeConnections, 3);
  assert.equal(api.metrics.realtime.changesSent, 3);
  assert.equal(api.checks.realtime.status, "ok");

  clients.forEach((client) => client.disconnect());
  await waitFor(() => metricsSnapshot().realtime.activeConnections === 0, "all closed");
  snapshot = metricsSnapshot();
  assert.equal(snapshot.realtime.closed, 3);
  assert.equal(snapshot.realtime.durationMs.samples, 3);
});

test("refusals are counted by reason and never become connections", async () => {
  assert.equal(await upgrade({ origin: "https://evil.example", cookie: realtime.member.cookie }), 403);
  assert.equal(await upgrade({ origin: realtime.origin }), 401);
  assert.equal(await upgrade({ origin: realtime.origin, cookie: "610_session=forged.value" }), 401);
  const pending = await realtime.auth.user("MENTOR", { status: "pending" });
  assert.equal(await upgrade({ origin: realtime.origin, cookie: pending.cookie }), 403);
  const snapshot = metricsSnapshot();
  assert.deepEqual(snapshot.realtime.rejected, { origin: 1, auth: 3, capacity: 0, unconfigured: 0 });
  assert.equal(snapshot.realtime.opened, 0);
});

test("malformed subscriptions are counted and close only that socket", async () => {
  const socket = new WebSocket(realtime.wsUrl, realtime.socketOptions());
  await new Promise((resolve) => socket.once("open", resolve));
  const code = new Promise<number>((resolve) => socket.once("close", resolve));
  socket.send("{\"type\":\"subscribe\",\"since\":");
  assert.equal(await code, 1008);
  await waitFor(() => metricsSnapshot().realtime.invalidSubscriptions === 1, "counted");
  assert.ok(metricsSnapshot().realtime.events.some((event) => event.type === "malformed-subscription"));
});

test("reconnects: the same account connecting again within a minute is a reconnect", async () => {
  const since = await target.lastSeq();
  const first = await realtime.connected(since);
  first.disconnect();
  await waitFor(() => metricsSnapshot().realtime.closed === 1, "closed");
  const second = await realtime.connected(since);
  assert.equal(metricsSnapshot().realtime.reconnects, 1);
  second.disconnect();
});

test("an authentication failure during upgrade answers 500 and is recorded, without opening a connection", async () => {
  const { createServer } = await import("node:http");
  const { createRealtimeUpgradeHandler } = await import("../../../lib/realtime/server.ts");
  const handler = createRealtimeUpgradeHandler({ getConfig: () => ({ url: target.changesUrl, authorization: target.authorization }), authenticate: async () => { throw new Error("session check exploded"); } });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => { handler(request, socket, head); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const status = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`${origin.replace("http", "ws")}/api/realtime`, { origin, headers: { cookie: realtime.member.cookie } });
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("open", () => resolve(101));
      socket.once("error", () => {});
    });
    assert.equal(status, 500);
    assert.ok(metricsSnapshot().errors.some((entry) => entry.source === "realtime-upgrade" && entry.message === "session check exploded"));
    assert.equal(metricsSnapshot().realtime.opened, 0);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test("revoking a session closes its open socket (4401) and the browser stops retrying", async () => {
  const scout = await realtime.auth.user("SCOUT");
  const runtime = authRuntime();
  assert.ok(runtime.ok);
  const socket = new WebSocket(realtime.wsUrl, realtime.socketOptions(scout));
  const frames: string[] = [];
  socket.on("message", (data) => frames.push(String(data)));
  await new Promise((resolve) => socket.once("open", resolve));
  socket.send(JSON.stringify({ type: "subscribe", since: await target.lastSeq() }));
  await waitFor(() => frames.some((frame) => frame.includes("ready")), "ready");
  const closed = new Promise<number>((resolve) => socket.once("close", resolve));
  await revokeUserSessions(runtime.store, scout.userId);
  assert.equal(await closed, 4401);
  await waitFor(() => metricsSnapshot().realtime.sessionEnded === 1, "counted");
  // After revocation it cannot come back.
  assert.equal(await upgrade({ origin: realtime.origin, cookie: scout.cookie }), 401);
});
