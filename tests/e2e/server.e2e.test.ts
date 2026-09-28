// Runs the real `scripts/server.mjs` (Next.js + realtime upgrade handling)
// against the fake Sync Gateway. Production mode needs `npm run build` first;
// set E2E_MODE=dev to exercise the development server instead.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { FakeSyncGateway, FAKE_DATABASE } from "../helpers/fake-sync-gateway.ts";

const mode = process.env.E2E_MODE === "dev" ? "development" : "production";
let gateway: FakeSyncGateway;
let app: ChildProcess;
let base: string;
let output = "";

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor<T>(check: () => T | Promise<T>, message: string, timeoutMs = 10_000): Promise<NonNullable<T>> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for: ${message}\n${output.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function openRealtime(since: unknown) {
  const socket = new WebSocket(`${base.replace("http", "ws")}/api/realtime`, { origin: base });
  const messages: Array<Record<string, unknown>> = [];
  let closeCode: number | undefined;
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  socket.on("close", (code) => { closeCode = code; });
  socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", since })));
  return { socket, messages, get closeCode() { return closeCode; } };
}

before(async () => {
  gateway = new FakeSyncGateway();
  const changesUrl = await gateway.start();
  gateway.put("aggregate_610", { type: "aggregate_data", team: 610, data: { standing: 1, matchesPlayed: 3 } });
  gateway.put("pit_610", { type: "pit", team: 610, data: { teamName: "Crescent Coyotes" } });
  gateway.put("scouting_610_1", { type: "scouting_data", team: 610, data: { start: { match: 1 } } });
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, ["--experimental-strip-types", "scripts/server.mjs"], {
    env: {
      ...process.env, NODE_ENV: mode, PORT: String(port), HOST: "127.0.0.1",
      COUCHBASE_SYNC_GATEWAY_URL: new URL(changesUrl).origin, COUCHBASE_DATABASE: FAKE_DATABASE,
      COUCHBASE_USERNAME: "user", COUCHBASE_PASSWORD: "pass",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout?.on("data", (chunk) => { output += chunk; });
  app.stderr?.on("data", (chunk) => { output += chunk; });
  await waitFor(() => output.includes("dashboard ready"), "server start", 60_000);
});

after(async () => {
  app?.kill();
  await gateway?.stop();
});

test("server-rendered pages and the REST API still work", async () => {
  const page = await fetch(`${base}/teams`);
  assert.equal(page.status, 200);
  const documents = await (await fetch(`${base}/api/dashboard-documents?kind=matches&team=610`)).json() as { documents: Array<{ _default: Record<string, unknown> }> };
  assert.equal(documents.documents.length, 1);
  assert.equal(documents.documents[0]._default._id, "scouting_610_1");
  assert.match(String(documents.documents[0]._default._rev), /^1-/);
  assert.equal((await fetch(`${base}/api/dashboard-documents?kind=bogus&team=610`)).status, 400);
});

test("realtime upgrades survive Next.js and stream new and updated records to every client", async () => {
  const since = String(gateway.lastSeq);
  const first = openRealtime(since); const second = openRealtime(since);
  await waitFor(() => first.messages.some((m) => m.type === "ready") && second.messages.some((m) => m.type === "ready"), "both clients ready", 30_000);

  const rev = gateway.put("scouting_610_2", { type: "scouting_data", team: 610, data: { start: { match: 2 }, teleop: { fuelscored: 6 } } });
  await waitFor(() => [first, second].every((client) => client.messages.some((m) => m.type === "change" && m.id === "scouting_610_2" && m.rev === rev)), "new record on both clients");
  const updated = gateway.put("scouting_610_2", { type: "scouting_data", team: 610, data: { start: { match: 2 }, teleop: { fuelscored: 8 } } });
  await waitFor(() => [first, second].every((client) => client.messages.some((m) => m.type === "change" && m.rev === updated)), "update on both clients");

  // Before this server existed, Next.js ended the socket right after the upgrade (close code 1006).
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(first.closeCode, undefined); assert.equal(second.closeCode, undefined);
  first.socket.close(); second.socket.close();
});

test("cross-origin realtime upgrades are refused", async () => {
  const socket = new WebSocket(`${base.replace("http", "ws")}/api/realtime`, { origin: "https://evil.example" });
  const status = await new Promise<number | undefined>((resolve) => {
    socket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    socket.once("open", () => resolve(undefined));
  });
  assert.equal(status, 403);
});
