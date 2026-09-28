import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { attachRealtimeBridge, isSameOriginUpgrade, type BridgeOptions } from "./realtime-bridge.ts";
import { getCouchbaseChangesConfig } from "./couchbase-config.ts";
import { startCouchbaseLongPoll, type CouchbaseChangesConfig } from "./couchbase-longpoll.ts";

export const REALTIME_PATH = "/api/realtime";

export interface RealtimeUpgradeOptions extends BridgeOptions {
  getConfig?: () => CouchbaseChangesConfig | null;
}

/**
 * Handles `upgrade` requests for the realtime path on a plain Node HTTP server.
 * Returns false for any other path so the caller can hand it to Next.js.
 */
export function createRealtimeUpgradeHandler(options: RealtimeUpgradeOptions = {}) {
  const { getConfig = getCouchbaseChangesConfig, ...bridgeOptions } = options;
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const reject = (socket: Duplex, status: string) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  return function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let pathname: string;
    try { pathname = new URL(request.url || "/", "http://localhost").pathname; } catch { socket.destroy(); return true; }
    if (pathname !== REALTIME_PATH) return false;
    if (!isSameOriginUpgrade(request.headers.origin, request.headers.host)) { reject(socket, "403 Forbidden"); return true; }
    const config = getConfig();
    if (!config) { reject(socket, "503 Service Unavailable"); return true; }
    webSockets.handleUpgrade(request, socket, head, (client) => {
      attachRealtimeBridge(client, (since, onFrame, onReady, onError) =>
        startCouchbaseLongPoll(config, since, onFrame, onReady, onError), bridgeOptions);
    });
    return true;
  };
}
