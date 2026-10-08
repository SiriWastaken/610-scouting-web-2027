// Server side of one browser's realtime connection: waits for the subscribe message, starts that browser's
// changes feed, relays frames, enforces limits and re-checks the session. See docs/12-realtime.md.
import { parseSubscription, type RealtimeFrame } from "./protocol.ts";
import { realtimeMetrics } from "../ops/metrics.ts";

/** The part of a WebSocket the bridge uses (the `ws` package matches it). */
export interface BridgeSocket {
  readyState: number;
  on(event: "message", listener: (data: { toString(): string }) => void): this;
  on(event: "close", listener: (code?: number) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}
/** Starts a changes feed from a cursor and returns the function that stops it. */
export type FeedStarter = (
  since: unknown,
  onFrame: (frame: RealtimeFrame) => void,
  onReady: () => void,
  onError: (error: Error & { resync?: boolean }) => void,
) => () => void;

/**
 * Limits and hooks for a bridged connection: timeouts, capacity, who opened it, and the session 
 * re-check.
 */
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
/** How many browsers are connected to this process right now. */
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
  if (activeConnections >= (options.maxConnections ?? 200)) {
    realtimeMetrics.rejected("capacity");
    client.close(1013, "Too many realtime connections");
    return;
  }
  activeConnections += 1;
  new BridgeConnection(client, startFeed, options);
}

class BridgeConnection {
  private readonly id: number;
  private readonly client: BridgeSocket;
  private readonly startFeed: FeedStarter;
  private stopFeed: (() => void) | undefined;
  private closed = false;
  private subscribed = false;
  private closeCode: number | undefined;
  private readonly timers: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | undefined>;
  private readonly subscriptionTimeout: ReturnType<typeof setTimeout>;

  constructor(client: BridgeSocket, startFeed: FeedStarter, options: BridgeOptions) {
    this.client = client;
    this.startFeed = startFeed;
    const { subscriptionTimeoutMs = 10_000, maxConnectionMs = 0, revalidate, revalidateMs = 60_000 } = options;
    this.id = realtimeMetrics.opened(options.identity);
    this.subscriptionTimeout = setTimeout(() => {
      realtimeMetrics.subscriptionTimeout(this.id);
      client.close(1008, "Subscription timed out");
    }, subscriptionTimeoutMs);
    const lifetime = maxConnectionMs > 0 ? setTimeout(() => client.close(1012, "Reconnect"), maxConnectionMs) : undefined;
    const sessionCheck = revalidate ? setInterval(() => this.checkSession(revalidate), revalidateMs) : undefined;
    this.timers = [this.subscriptionTimeout, lifetime, sessionCheck];

    client.on("message", (data) => this.onMessage(data.toString()));
    client.on("close", (code) => { this.closeCode = typeof code === "number" ? code : undefined; this.cleanup(); });
    client.on("error", (error) => {
      console.error("Realtime socket error:", error instanceof Error ? error.message : "unknown error");
      this.cleanup();
    });
  }

  private send(message: unknown) {
    if (this.closed || this.client.readyState !== OPEN) return;
    try {
      this.client.send(JSON.stringify(message));
      const frame = message as { type: string; id?: string; seq?: unknown };
      if (frame.type === "change" || frame.type === "cursor") realtimeMetrics.frameSent(this.id, frame);
    } catch (error) {
      realtimeMetrics.sendError(this.id, error);
      console.error("Realtime send failed:", error instanceof Error ? error.message : error);
    }
  }

  private checkSession(revalidate: () => Promise<boolean>) {
    revalidate().then((valid) => {
      if (valid || this.closed) return;
      realtimeMetrics.sessionEnded(this.id);
      this.client.close(SESSION_ENDED, "Session ended");
      this.closeCode = SESSION_ENDED;
      this.cleanup();
    // An account store outage is not the user's fault; keep serving until the store answers.
    }, () => {});
  }

  /** Only the first message matters; anything after a valid subscription is ignored. */
  private onMessage(raw: string) {
    if (this.subscribed || this.closed) return;
    const subscription = parseSubscription(raw);
    if (!subscription) {
      realtimeMetrics.invalidSubscription(this.id);
      this.client.close(1008, "Invalid subscription");
      return;
    }
    this.subscribed = true;
    clearTimeout(this.subscriptionTimeout);
    realtimeMetrics.subscribed(this.id, subscription.since);
    this.start(subscription.since);
  }

  private start(since: unknown) {
    try {
      this.stopFeed = this.startFeed(since, (frame) => this.send(frame), () => this.send({ type: "ready" }), (error) => this.onFeedError(error));
    } catch (error) {
      console.error("Realtime feed could not start:", error instanceof Error ? error.message : error);
      realtimeMetrics.feedError(this.id, error, false);
      this.client.close(1011, "Changes feed unavailable");
    }
  }

  private onFeedError(error: Error & { resync?: boolean }) {
    logFeedError(error.message);
    realtimeMetrics.feedError(this.id, error, error.resync === true);
    this.send({ type: "error", retryable: true, resync: error.resync === true });
    if (this.client.readyState === OPEN) this.client.close(1011, "Changes feed disconnected");
    this.cleanup();
  }

  private cleanup() {
    if (this.closed) return;
    this.closed = true;
    activeConnections -= 1;
    for (const timer of this.timers) clearTimeout(timer);
    this.stopFeed?.();
    this.stopFeed = undefined;
    realtimeMetrics.closed(this.id, this.closeCode);
  }
}
