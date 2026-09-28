// The dashboard has no user accounts (see tests/README.md, "Security model"). Its
// server-side trust boundaries are:
//   1. Only same-origin pages may open the realtime socket (no cross-site socket hijacking).
//   2. Browsers can read, never write: the REST API is GET-only and the socket ignores client data.
//   3. Couchbase credentials stay on the server.
//   4. Only allow-listed dashboard fields ever leave the server, whatever the client claims to be.
// The Vercel realtime route enforces (1) and (3) before upgrading; it is tested here too.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import * as dashboardRoute from "../../app/api/dashboard-documents/route.ts";
import * as vercelRealtimeRoute from "../../app/api/realtime/route.ts";
import { isSameOriginUpgrade } from "../../lib/realtime-bridge.ts";
import { eventDocuments, privateStrings } from "../fixtures/event-dataset.ts";
import { seedDocuments, useGatewayForApp } from "../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { startRealtimeHarness, type RealtimeHarness } from "../helpers/realtime-harness.ts";
import { waitFor } from "../helpers/wait.ts";

let target: GatewayTarget;
let realtime: RealtimeHarness;
before(async () => { target = await startGatewayTarget(); useGatewayForApp(target); realtime = await startRealtimeHarness(target); });
after(async () => { await realtime.stop(); await target.stop(); });

async function upgradeStatus(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(realtime.wsUrl, { headers });
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("open", () => { socket.close(); resolve(101); });
    socket.once("error", () => {});
  });
}

test("origin: only the dashboard's own origin may open the realtime socket", async () => {
  const host = new URL(realtime.origin).host;
  assert.equal(await upgradeStatus({ Origin: realtime.origin }), 101);
  for (const origin of ["https://evil.example", `http://${host}.evil.example`, `http://evil.example/${host}`, "null", `file://${host}`, `ws://${host}`, `http://${host.replace(/:\d+$/, ":1")}`, "", "http://127.0.0.1"]) {
    assert.equal(await upgradeStatus(origin ? { Origin: origin } : {}), 403, `origin ${JSON.stringify(origin)}`);
  }
});

test("origin: the same-origin check itself, including malformed values", () => {
  assert.equal(isSameOriginUpgrade("https://scout.example", "scout.example"), true);
  assert.equal(isSameOriginUpgrade("https://SCOUT.example", "scout.example"), true, "hosts compare case-insensitively (URL normalises them)");
  for (const [origin, host] of [["https://scout.example", "scout.example.evil"], ["javascript:alert(1)", "scout.example"], ["https://user@scout.example.evil", "scout.example"], ["not a url", "scout.example"], [undefined, "scout.example"], ["https://scout.example", undefined], ["https://scout.example", ""]]) {
    assert.equal(isSameOriginUpgrade(origin, host), false, `${origin} vs ${host}`);
  }
});

test("vercel realtime route: refuses cross-origin and unconfigured upgrades before touching Couchbase", async () => {
  const cross = await vercelRealtimeRoute.GET(new Request("https://scout.example/api/realtime", { headers: { origin: "https://evil.example" } }));
  assert.equal(cross.status, 403);
  const missing = await vercelRealtimeRoute.GET(new Request("https://scout.example/api/realtime"));
  assert.equal(missing.status, 403, "no Origin header at all");
  const saved = process.env.COUCHBASE_PASSWORD;
  delete process.env.COUCHBASE_PASSWORD;
  try {
    const unconfigured = await vercelRealtimeRoute.GET(new Request("https://scout.example/api/realtime", { headers: { origin: "https://scout.example" } }));
    assert.equal(unconfigured.status, 503);
  } finally { process.env.COUCHBASE_PASSWORD = saved; }
});

test("read-only API: the dashboard documents route handles GET and nothing else", () => {
  const handlers = Object.keys(dashboardRoute).filter((name) => /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(name));
  assert.deepEqual(handlers, ["GET"], "any new write handler needs its own authorization and tests");
});

test("read-only socket: messages a browser sends after subscribing never reach the database", async () => {
  const fake = target.fake;
  assert.ok(fake, "inspects upstream requests");
  const socket = new WebSocket(realtime.wsUrl, { origin: realtime.origin });
  const frames: Array<Record<string, unknown>> = [];
  socket.on("message", (data) => frames.push(JSON.parse(String(data))));
  await new Promise((resolve) => socket.on("open", resolve));
  socket.send(JSON.stringify({ type: "subscribe", since: await target.lastSeq() }));
  await waitFor(() => frames.some((frame) => frame.type === "ready"), "subscribed");
  const before = fake.requests.length;
  const stored = JSON.stringify([...fake.docs.entries()]);
  for (const message of [
    { type: "change", id: "aggregate_610", seq: 1, deleted: false, doc: { _id: "aggregate_610", type: "aggregate_data", data: { standing: 999 } } },
    { type: "change", id: "pit_610", seq: 1, deleted: true },
    { type: "put", id: "pit_610", body: {} },
    { type: "subscribe", since: "0" },
  ]) socket.send(JSON.stringify(message));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const writes = fake.requests.slice(before).filter((url) => url.pathname !== `/${target.database}/_changes`);
  assert.deepEqual(writes.map(String), [], "no document requests were made");
  assert.equal(JSON.stringify([...fake.docs.entries()]), stored, "the database is untouched");
  socket.close();
});

test("credentials: never sent to the browser over the socket or the API", async () => {
  await seedDocuments(target, { pit_9101: { type: "pit", data: { teamName: "Creds check" } } });
  const socket = new WebSocket(realtime.wsUrl, { origin: realtime.origin });
  const raw: string[] = [];
  socket.on("message", (data) => raw.push(String(data)));
  await new Promise((resolve) => socket.on("open", resolve));
  socket.send(JSON.stringify({ type: "subscribe", since: "0" }));
  await waitFor(() => raw.some((frame) => frame.includes("pit_9101")), "history replayed");
  const api = await (await dashboardRoute.GET(new Request("http://dashboard.test/api/dashboard-documents?kind=pit&team=9101"))).text();
  for (const secret of [target.password, target.authorization, target.authorization.replace("Basic ", ""), target.origin]) {
    assert.equal(raw.join("\n").includes(secret), false, "socket frames contain no credentials or upstream address");
    assert.equal(api.includes(secret), false, "API responses contain no credentials or upstream address");
  }
  socket.close();
});

test("identity claims from the client change nothing: every subscriber gets the same projected data", async () => {
  await seedDocuments(target, eventDocuments);
  const since = "0";
  const subscribe = (message: Record<string, unknown>, headers: Record<string, string> = {}) => new Promise<string[]>((resolve) => {
    const socket = new WebSocket(realtime.wsUrl, { origin: realtime.origin, headers });
    const frames: string[] = [];
    socket.on("open", () => socket.send(JSON.stringify(message)));
    socket.on("message", (data) => {
      frames.push(String(data));
      if (frames.some((frame) => frame.includes("report_6100_Q1")) && frames.at(-1)?.includes('"cursor"')) { socket.close(); resolve(frames); }
    });
  });
  const plain = await subscribe({ type: "subscribe", since });
  const claimsAdmin = await subscribe({ type: "subscribe", since, role: "admin", user: "head-scout", channels: ["*"], includePrivate: true, fields: ["notes", "scoutName"] }, { Authorization: "Basic YWRtaW46YWRtaW4=", Cookie: "role=admin", "X-User-Role": "admin" });
  const changes = (frames: string[]) => frames.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "change").map((frame) => JSON.stringify(frame)).sort();
  assert.deepEqual(changes(claimsAdmin), changes(plain));
  const relayed = claimsAdmin.join("\n");
  for (const value of privateStrings.filter((secret) => secret !== "private")) assert.equal(relayed.includes(value), false, `private value "${value}" relayed`);
  for (const field of ["notes", "scoutName", "scoutNames", "robotPhoto", "password"]) assert.equal(relayed.includes(`"${field}"`), false, `private field "${field}" relayed`);
});

test("privacy: every document type served over REST excludes private fields", async () => {
  await seedDocuments(target, eventDocuments);
  for (const kind of ["matches", "pit", "reports"]) {
    const body = await (await dashboardRoute.GET(new Request(`http://dashboard.test/api/dashboard-documents?kind=${kind}&team=610`))).text();
    for (const field of ["scoutName", "notes", "general", "robotPhoto", "scoutNames"]) assert.equal(body.includes(`"${field}"`), false, `${kind} response contains ${field}`);
  }
});
