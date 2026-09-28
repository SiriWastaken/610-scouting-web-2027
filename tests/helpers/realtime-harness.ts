// The realtime server as `scripts/server.mjs` mounts it (the real upgrade
// handler, bridge, and long-poll) on a plain HTTP server, plus browser-style
// RealtimeClients connected to it over real WebSockets.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import WebSocket from "ws";
import { RealtimeClient, type SocketLike } from "../../lib/realtime/client.ts";
import { createRealtimeUpgradeHandler } from "../../lib/realtime/server.ts";
import type { BridgeOptions } from "../../lib/realtime/bridge.ts";
import type { GatewayTarget } from "./gateway-target.ts";
import { startTestAuth, type TestAuth, type TestUser } from "./auth.ts";
import { waitFor } from "./wait.ts";

export interface RealtimeHarness {
  origin: string;
  wsUrl: string;
  /** The account store and provider the upgrade handler checks sessions against. */
  auth: TestAuth;
  /** A signed-in, active MEMBER: the least privileged account allowed to read the feed. */
  member: TestUser;
  /** Options for a raw `ws` client that looks like a signed-in browser on this origin. */
  socketOptions(user?: Pick<TestUser, "cookie"> | null): { origin: string; headers: Record<string, string> };
  /** Cuts every open connection (a network drop). */
  dropConnections(): void;
  /** While true, upgrades are refused (the server is unreachable). */
  setReachable(reachable: boolean): void;
  /** Stops the server process-equivalent and starts a new one on the same port. */
  restart(): Promise<void>;
  client(options?: { retryBaseMs?: number; retryMaxMs?: number }): RealtimeClient;
  /** Connects a client from `cursor` and waits until the server reports ready. */
  connected(cursor: unknown, client?: RealtimeClient): Promise<RealtimeClient>;
  stop(): Promise<void>;
}

export async function startRealtimeHarness(target: GatewayTarget, options: Omit<BridgeOptions, "identity" | "revalidate"> & { auth?: TestAuth } = {}): Promise<RealtimeHarness> {
  const { auth: providedAuth, ...bridgeOptions } = options;
  // Sessions are checked for real: the handler reads AUTH_* from the environment, like scripts/server.mjs.
  const auth = providedAuth ?? await startTestAuth();
  auth.apply();
  const member = await auth.user("MEMBER");
  let server: Server;
  let reachable = true;
  const sockets = new Set<Duplex>();
  const clients: RealtimeClient[] = [];
  let port = 0;
  const listen = async () => {
    const handleUpgrade = createRealtimeUpgradeHandler({ ...bridgeOptions, getConfig: () => ({ url: target.changesUrl, authorization: target.authorization }) });
    server = createServer((_request, response) => { response.writeHead(404); response.end(); });
    server.on("upgrade", (request, socket, head) => {
      if (!reachable) { socket.destroy(); return; }
      sockets.add(socket); socket.on("close", () => sockets.delete(socket));
      if (!handleUpgrade(request, socket, head)) socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  };
  const close = async () => {
    sockets.forEach((socket) => socket.destroy());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  await listen();
  const origin = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/api/realtime`;
  const socketOptions = (user: Pick<TestUser, "cookie"> | null = member): { origin: string; headers: Record<string, string> } => ({ origin, headers: user ? { cookie: user.cookie } : {} });
  const harness: RealtimeHarness = {
    origin, wsUrl, auth, member, socketOptions,
    dropConnections: () => sockets.forEach((socket) => socket.destroy()),
    setReachable: (value) => { reachable = value; },
    restart: async () => { await close(); await listen(); },
    client(clientOptions = {}) {
      const client = new RealtimeClient({
        url: () => wsUrl,
        createSocket: (url) => new WebSocket(url, socketOptions()) as unknown as SocketLike,
        retryBaseMs: clientOptions.retryBaseMs ?? 20, retryMaxMs: clientOptions.retryMaxMs ?? 150,
      });
      clients.push(client);
      return client;
    },
    async connected(cursor, client = harness.client()) {
      client.connect(String(cursor));
      await waitFor(() => client.getStatus() === "connected", "realtime client connected", 10_000);
      return client;
    },
    async stop() { clients.forEach((client) => client.disconnect()); await close(); if (!providedAuth) await auth.stop(); },
  };
  return harness;
}
