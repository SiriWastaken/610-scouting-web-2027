import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { attachRealtimeBridge, isSameOriginUpgrade, type BridgeOptions } from "./bridge.ts";
import { getCouchbaseChangesConfig } from "../data/couchbase-config.ts";
import { startCouchbaseLongPoll, type CouchbaseChangesConfig } from "./couchbase-feed.ts";
import { authenticateCookieHeader, type Authentication } from "../auth/requests.ts";
import { can } from "../auth/roles.ts";
import type { Viewer } from "../auth/sessions.ts";
import { realtimeMetrics, recordError } from "../ops/metrics.ts";

const REALTIME_PATH = "/api/realtime";

export interface RealtimeUpgradeOptions extends Omit<BridgeOptions, "identity" | "revalidate"> {
  getConfig?: () => CouchbaseChangesConfig | null;
  /** Who is upgrading. Defaults to the session cookie checked against the account store. */
  authenticate?: (cookieHeader: string | string[] | undefined) => Promise<Authentication>;
}

export type UpgradeDecision =
  | { ok: true; viewer: Viewer }
  | { ok: false; status: 401 | 403 | 503; reason: "auth" | "unconfigured" };

/**
 * The realtime feed carries scouting data, so it needs the same permission as
 * the dashboard pages. Shared by this handler and the Vercel route.
 */
export function upgradeDecision(auth: Authentication): UpgradeDecision {
  if (auth.status === "unavailable") return { ok: false, status: 503, reason: "unconfigured" };
  if (auth.status === "signed-out") return { ok: false, status: 401, reason: "auth" };
  return can(auth.viewer.principal, "dashboard:read") ? { ok: true, viewer: auth.viewer } : { ok: false, status: 403, reason: "auth" };
}

/**
 * Bridge options for an accepted connection: who it belongs to, and a periodic
 * re-check of the same session (an unreachable account store keeps the socket
 * open rather than cutting everyone off).
 */
export function sessionBridgeOptions(viewer: Viewer, recheck: () => Promise<Authentication>): Pick<BridgeOptions, "identity" | "revalidate"> {
  return {
    identity: { userId: viewer.userId, role: viewer.principal.role },
    revalidate: async () => {
      const current = await recheck();
      if (current.status === "unavailable") throw new Error(current.reason);
      return upgradeDecision(current).ok;
    },
  };
}

const STATUS_TEXT = { 401: "401 Unauthorized", 403: "403 Forbidden", 500: "500 Internal Server Error", 503: "503 Service Unavailable" } as const;

function reject(socket: Duplex, status: keyof typeof STATUS_TEXT) {
  socket.end(`HTTP/1.1 ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Handles `upgrade` requests for the realtime path on a plain Node HTTP server.
 * Returns false for any other path so the caller can hand it to Next.js.
 */
export function createRealtimeUpgradeHandler(options: RealtimeUpgradeOptions = {}) {
  const { getConfig = getCouchbaseChangesConfig, authenticate = (cookie) => authenticateCookieHeader(cookie), ...bridgeOptions } = options;
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  return function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let pathname: string;
    try { pathname = new URL(request.url || "/", "http://localhost").pathname; } catch { socket.destroy(); return true; }
    if (pathname !== REALTIME_PATH) return false;
    if (!isSameOriginUpgrade(request.headers.origin, request.headers.host)) { realtimeMetrics.rejected("origin"); reject(socket, 403); return true; }
    const config = getConfig();
    if (!config) { realtimeMetrics.rejected("unconfigured"); reject(socket, 503); return true; }
    const cookie = request.headers.cookie;
    void authenticate(cookie).then((auth) => {
      const decision = upgradeDecision(auth);
      if (!decision.ok) { realtimeMetrics.rejected(decision.reason); reject(socket, decision.status); return; }
      if (socket.destroyed) return;
      webSockets.handleUpgrade(request, socket, head, (client) => {
        attachRealtimeBridge(client, (since, onFrame, onReady, onError) =>
          startCouchbaseLongPoll(config, since, onFrame, onReady, onError),
        { ...bridgeOptions, ...sessionBridgeOptions(decision.viewer, () => authenticate(cookie)) });
      });
    }, (error) => {
      recordError("realtime-upgrade", error);
      if (!socket.destroyed) reject(socket, 500);
    });
    return true;
  };
}
