// The production server exactly as `npm start` runs it (scripts/server.mjs:
// Next.js plus realtime WebSocket upgrades), driven over plain HTTP and
// WebSocket like a browser would, against the fake Sync Gateway.
// Needs `npm run build` first (npm run test:e2e does it); E2E_MODE=dev uses the dev server.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { RealtimeClient, type SocketLike } from "../../lib/realtime-client.ts";
import { startAppServer, type AppServer } from "../helpers/app-server.ts";
import { eventDocuments, expectedMatchIds610, privateStrings } from "../fixtures/event-dataset.ts";
import { seedDocuments } from "../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { waitFor } from "../helpers/wait.ts";

let target: GatewayTarget;
let app: AppServer;
const clients: RealtimeClient[] = [];

before(async () => {
  target = await startGatewayTarget();
  await seedDocuments(target, eventDocuments);
  app = await startAppServer({ ...target.appEnv(), TBA_API_KEY: "" });
});
after(async () => { clients.forEach((client) => client.disconnect()); await app?.stop(); await target?.stop(); });

const wsUrl = () => `${app.base.replace("http", "ws")}/api/realtime`;
function browserClient() {
  const client = new RealtimeClient({ url: wsUrl, createSocket: (url) => new WebSocket(url, { origin: app.base }) as unknown as SocketLike, retryBaseMs: 50, retryMaxMs: 500 });
  clients.push(client);
  return client;
}

test("pages: every dashboard route renders, unknown teams 404, and / redirects to /teams", async () => {
  for (const path of ["/teams", "/averages", "/box-plot", "/coverage", "/strategy", "/teams/610"]) {
    const response = await fetch(`${app.base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /610 \/ SCOUTING/, `${path} renders the app shell`);
  }
  assert.equal((await fetch(`${app.base}/teams/99999`)).status, 404);
  assert.equal((await fetch(`${app.base}/teams/not-a-number`)).status, 404);
  const root = await fetch(`${app.base}/`, { redirect: "manual" });
  assert.ok([307, 308].includes(root.status));
  assert.equal(new URL(root.headers.get("location")!, app.base).pathname, "/teams");
});

test("secrets: no page or JavaScript bundle contains credentials, the upstream address, or private fields", async () => {
  const assets = new Set<string>();
  const bodies: Array<[string, string]> = [];
  for (const path of ["/teams", "/averages", "/coverage", "/strategy", "/teams/610", "/box-plot"]) {
    const html = await (await fetch(`${app.base}${path}`)).text();
    bodies.push([path, html]);
    for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.(?:js|css))"/g)) assets.add(match[1]);
  }
  assert.ok(assets.size > 0, "found the page's JavaScript bundles");
  for (const asset of assets) bodies.push([asset, await (await fetch(`${app.base}${asset}`)).text()]);
  const secrets = [target.password, target.authorization.replace("Basic ", ""), target.origin, ...privateStrings.filter((value) => value !== "private"), '"scoutNames"', '"scoutName"', '"notes"'];
  for (const [where, body] of bodies) for (const secret of secrets) assert.equal(body.includes(secret), false, `${where} contains ${secret}`);
});

test("api over HTTP: GET works with the right headers; every other method is refused", async () => {
  const response = await fetch(`${app.base}/api/dashboard-documents?kind=matches&team=610`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const { documents } = await response.json() as { documents: Array<{ _default: { _id: string } }> };
  assert.deepEqual(documents.map((document) => document._default._id).sort(), expectedMatchIds610);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const refused = await fetch(`${app.base}/api/dashboard-documents?kind=matches&team=610`, { method, body: method === "DELETE" ? undefined : "{}", headers: { "Content-Type": "application/json" } });
    assert.equal(refused.status, 405, method);
  }
  assert.equal((await fetch(`${app.base}/api/dashboard-documents?kind=matches&team=-1`)).status, 400);
  assert.equal((await fetch(`${app.base}/api/dashboard-documents?kind=matches&team=1&team=2`)).status, 200, "repeated parameters use the first value");
});

test("realtime: two browsers receive creates, updates, and deletes through the production server", async () => {
  const first = browserClient(); const second = browserClient();
  const since = await target.lastSeq();
  first.connect(since); second.connect(since);
  await waitFor(() => first.getStatus() === "connected" && second.getStatus() === "connected", "both connected", 30_000, app.output);
  const created = await target.upsert("scouting_610_20", { type: "scouting_data", team: 610, data: { start: { match: 20 }, teleop: { fuelscored: 6 } } });
  await waitFor(() => [first, second].every((client) => client.store.get("scouting_610_20")?.rev === created), "create", 10_000);
  const updated = await target.upsert("scouting_610_20", { type: "scouting_data", team: 610, data: { start: { match: 20 }, teleop: { fuelscored: 8 } } });
  await waitFor(() => [first, second].every((client) => client.store.get("scouting_610_20")?.rev === updated), "update", 10_000);
  const deleted = await target.destroy("scouting_610_20");
  await waitFor(() => [first, second].every((client) => client.store.get("scouting_610_20")?.rev === deleted && client.store.get("scouting_610_20")?.deleted), "delete", 10_000);
  // Before scripts/server.mjs existed, Next.js ended every upgraded socket immediately (close 1006).
  assert.equal(first.getStatus(), "connected");
  first.disconnect(); second.disconnect();
});

test("realtime: cross-origin, origin-less, and wrong-path upgrades are refused", async () => {
  const status = (url: string, origin?: string) => new Promise<number | "open" | "closed" | "left hanging">((resolve) => {
    const socket = new WebSocket(url, origin ? { origin } : {});
    setTimeout(() => { socket.terminate(); resolve("left hanging"); }, 5000);
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.once("open", () => { socket.close(); resolve("open"); });
    socket.once("error", () => resolve("closed"));
  });
  assert.equal(await status(wsUrl(), "https://evil.example"), 403);
  assert.equal(await status(wsUrl()), 403);
  assert.equal(await status(`${app.base.replace("http", "ws")}/api/not-realtime`, app.base), "closed", "other upgrade paths are closed, not left open or hanging");
});

test("server restart: connected browsers reconnect and receive everything written while it was down", async () => {
  const client = browserClient();
  client.connect(await target.lastSeq());
  await waitFor(() => client.getStatus() === "connected", "connected", 30_000, app.output);
  const stopping = app.stop();
  await waitFor(() => client.getStatus() === "reconnecting", "client noticed the restart", 10_000);
  await stopping;
  const whileDown = await target.upsert("pit_610", { type: "pit", team: 610, data: { teamName: "Renamed While Down" } });
  await app.restart();
  await waitFor(() => client.getStatus() === "connected" && client.store.get("pit_610")?.rev === whileDown, "reconnected and caught up", 60_000, app.output);
  const page = await (await fetch(`${app.base}/teams/610`)).text();
  assert.match(page, /Renamed While Down/, "freshly rendered pages also show the change");
  client.disconnect();
});

test("unconfigured server: pages show the empty state and the realtime endpoint reports 503", async () => {
  const bare = await startAppServer({ COUCHBASE_SYNC_GATEWAY_URL: "", COUCHBASE_DATABASE: "", COUCHBASE_USERNAME: "", COUCHBASE_PASSWORD: "", TBA_API_KEY: "" });
  try {
    const html = await (await fetch(`${bare.base}/averages`)).text();
    assert.match(html, /No live aggregate data is available/);
    const status = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`${bare.base.replace("http", "ws")}/api/realtime`, { origin: bare.base });
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("open", () => { socket.close(); resolve(101); });
      socket.once("error", () => {});
    });
    assert.equal(status, 503);
  } finally { await bare.stop(); }
});
