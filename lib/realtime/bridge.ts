import { parseSubscription, type RealtimeFrame } from "./protocol.ts";
import { realtimeMetrics } from "../ops/metrics.ts";

export interface BridgeSocket {
  readyState: number;
  on(event: "message", listener: (data: { toString(): string }) => void): this;
  on(event: "close", listener: (code?: number) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}
export type FeedStarter = (
  since: unknown,
  onFrame: (frame: RealtimeFrame) => void,
  onReady: () => void,
  onError: (error: Error & { resync?: boolean }) => void,
) => () => void;

export interface BridgeOptions {
  subscriptionTimeoutMs?: number;
  /** Close healthy connections (code 1012) before a hosting platform would cut them off. */
  maxConnectionMs?: number;
  maxConnections?: number;
  /** Who opened the connection, for the admin panel's connection list. */
  identity?: { userId?: string; role?: string };
  /**
   * Re-checks the connection's session. Resolving false closes the socket with
   * {@link SESSION_ENDED}, so a revoked, expired, or disabled account stops
   * receiving data without waiting for the connection to drop.
   */
  revalidate?: () => Promise<boolean>;
  revalidateMs?: number;
}

/** Close code sent when the connection's session is no longer valid; the browser must not retry. */
export const SESSION_ENDED = 4401;

const OPEN = 1;
let activeConnections = 0;
let lastFeedErrorLog = { message: "", at: 0 };
/** An upstream outage fails every connection on every retry; log it once per interval, not once per socket. */
function logFeedError(message: string) {
  const now = Date.now();
  if (message === lastFeedErrorLog.message && now - lastFeedErrorLog.at < 30_000) return;
  lastFeedErrorLog = { message, at: now };
  console.error("Realtime changes feed failed:", message);
}
export function getActiveRealtimeConnections() { return activeConnections; }

/** Browsers always send Origin on WebSocket upgrades; only accept our own host. */
export function isSameOriginUpgrade(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host === host;
  } catch { return false; }
}

/**
 * Relays one browser connection to its own Couchbase changes feed. The browser
 * must send a single `{ type: "subscribe", since }` message; the feed then
 * starts from that cursor, so a reconnecting client receives everything it missed.
 */
export function attachRealtimeBridge(client: BridgeSocket, startFeed: FeedStarter, options: BridgeOptions = {}): void {
  const { subscriptionTimeoutMs = 10_000, maxConnectionMs = 0, maxConnections = 200, revalidate, revalidateMs = 60_000 } = options;
  if (activeConnections >= maxConnections) {
    realtimeMetrics.rejected("capacity");
    client.close(1013, "Too many realtime connections");
    return;
  }
  activeConnections += 1;
  const connectionId = realtimeMetrics.opened(options.identity);
  let stopFeed: (() => void) | undefined;
  let closed = false;
  let subscribed = false;
  const send = (message: unknown) => {
    if (closed || client.readyState !== OPEN) return;
    try {
      client.send(JSON.stringify(message));
      const frame = message as { type: string; id?: string; seq?: unknown };
      if (frame.type === "change" || frame.type === "cursor") realtimeMetrics.frameSent(connectionId, frame);
    } catch (error) {
      realtimeMetrics.sendError(connectionId, error);
      console.error("Realtime send failed:", error instanceof Error ? error.message : error);
    }
  };
  const subscriptionTimeout = setTimeout(() => { realtimeMetrics.subscriptionTimeout(connectionId); client.close(1008, "Subscription timed out"); }, subscriptionTimeoutMs);
  const lifetime = maxConnectionMs > 0 ? setTimeout(() => client.close(1012, "Reconnect"), maxConnectionMs) : undefined;
  const sessionCheck = revalidate ? setInterval(() => {
    revalidate().then((valid) => {
      if (valid || closed) return;
      realtimeMetrics.sessionEnded(connectionId);
      client.close(SESSION_ENDED, "Session ended");
      closeCode = SESSION_ENDED;
      cleanup();
    // An account store outage is not the user's fault; keep serving until the store answers.
    }, () => {});
  }, revalidateMs) : undefined;
  let closeCode: number | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    activeConnections -= 1;
    clearTimeout(subscriptionTimeout); clearTimeout(lifetime); clearInterval(sessionCheck);
    stopFeed?.(); stopFeed = undefined;
    realtimeMetrics.closed(connectionId, closeCode);
  };

  client.on("message", (data) => {
    // Only the first message matters; anything after a valid subscription is ignored.
    if (subscribed || closed) return;
    const subscription = parseSubscription(data.toString());
    if (!subscription) {
      realtimeMetrics.invalidSubscription(connectionId);
      client.close(1008, "Invalid subscription");
      return;
    }
    subscribed = true;
    clearTimeout(subscriptionTimeout);
    realtimeMetrics.subscribed(connectionId, subscription.since);
    try {
      stopFeed = startFeed(subscription.since,
        (frame) => send(frame),
        () => send({ type: "ready" }),
        (error) => {
          logFeedError(error.message);
          realtimeMetrics.feedError(connectionId, error, error.resync === true);
          send({ type: "error", retryable: true, resync: error.resync === true });
          if (client.readyState === OPEN) client.close(1011, "Changes feed disconnected");
          cleanup();
        },
      );
    } catch (error) {
      console.error("Realtime feed could not start:", error instanceof Error ? error.message : error);
      realtimeMetrics.feedError(connectionId, error, false);
      client.close(1011, "Changes feed unavailable");
    }
  });
  client.on("close", (code) => { closeCode = typeof code === "number" ? code : undefined; cleanup(); });
  client.on("error", (error) => {
    console.error("Realtime socket error:", error instanceof Error ? error.message : "unknown error");
    cleanup();
  });
}
