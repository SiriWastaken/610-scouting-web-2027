import { parseSubscription, type RealtimeFrame } from "./realtime-protocol.ts";

export interface BridgeSocket {
  readyState: number;
  on(event: "message", listener: (data: { toString(): string }) => void): this;
  on(event: "close", listener: () => void): this;
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
}

const OPEN = 1;
let activeConnections = 0;
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
  const { subscriptionTimeoutMs = 10_000, maxConnectionMs = 0, maxConnections = 200 } = options;
  if (activeConnections >= maxConnections) {
    client.close(1013, "Too many realtime connections");
    return;
  }
  activeConnections += 1;
  let stopFeed: (() => void) | undefined;
  let closed = false;
  let subscribed = false;
  const send = (message: unknown) => {
    if (closed || client.readyState !== OPEN) return;
    try { client.send(JSON.stringify(message)); } catch (error) { console.error("Realtime send failed:", error instanceof Error ? error.message : error); }
  };
  const subscriptionTimeout = setTimeout(() => client.close(1008, "Subscription timed out"), subscriptionTimeoutMs);
  const lifetime = maxConnectionMs > 0 ? setTimeout(() => client.close(1012, "Reconnect"), maxConnectionMs) : undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    activeConnections -= 1;
    clearTimeout(subscriptionTimeout); clearTimeout(lifetime);
    stopFeed?.(); stopFeed = undefined;
  };

  client.on("message", (data) => {
    // Only the first message matters; anything after a valid subscription is ignored.
    if (subscribed || closed) return;
    const subscription = parseSubscription(data.toString());
    if (!subscription) {
      client.close(1008, "Invalid subscription");
      return;
    }
    subscribed = true;
    clearTimeout(subscriptionTimeout);
    try {
      stopFeed = startFeed(subscription.since,
        (frame) => send(frame),
        () => send({ type: "ready" }),
        (error) => {
          console.error("Realtime changes feed failed:", error.message);
          send({ type: "error", retryable: true, resync: error.resync === true });
          if (client.readyState === OPEN) client.close(1011, "Changes feed disconnected");
          cleanup();
        },
      );
    } catch (error) {
      console.error("Realtime feed could not start:", error instanceof Error ? error.message : error);
      client.close(1011, "Changes feed unavailable");
    }
  });
  client.on("close", cleanup);
  client.on("error", (error) => {
    console.error("Realtime socket error:", error instanceof Error ? error.message : "unknown error");
    cleanup();
  });
}
