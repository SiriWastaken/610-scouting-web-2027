import { parseServerMessage } from "./protocol.ts";
import { DocumentStore } from "./documents.ts";

export type RealtimeStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

/** The subset of the browser WebSocket API the client relies on (the `ws` package matches it too). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason: string; wasClean: boolean }) => void): void;
  addEventListener(type: "error", listener: () => void): void;
}

export interface RealtimeClientOptions {
  url?: () => string;
  createSocket?: (url: string) => SocketLike;
  handshakeTimeoutMs?: number;
  readyTimeoutMs?: number;
  /** The server relays a cursor at least every ~25 s; silence beyond this means the link is dead. */
  idleTimeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

const CONNECTING = 0;
const OPEN = 1;
/** Sent by the server when it closes a healthy connection on purpose (for example before a platform timeout). */
const SERVICE_RESTART = 1012;
/** Sent by the server when the connection's session was revoked or expired (lib/realtime-bridge.ts). Retrying cannot help. */
const SESSION_ENDED = 4401;

function defaultUrl() {
  const { protocol, host } = globalThis.location;
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/api/realtime`;
}

export class RealtimeClient {
  readonly store = new DocumentStore();
  private readonly options: Required<RealtimeClientOptions>;
  private socket: SocketLike | null = null;
  private cursor: unknown;
  private status: RealtimeStatus = "disconnected";
  private retryAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private version = 0;
  private snapshotNames: Readonly<Record<string, string>> = {};
  private readonly storeListeners = new Set<() => void>();
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  private readonly resyncListeners = new Set<() => void>();
  private readonly sessionEndedListeners = new Set<() => void>();

  constructor(options: RealtimeClientOptions = {}) {
    this.options = {
      url: options.url ?? defaultUrl,
      createSocket: options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike),
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 15_000,
      readyTimeoutMs: options.readyTimeoutMs ?? 20_000,
      idleTimeoutMs: options.idleTimeoutMs ?? 75_000,
      retryBaseMs: options.retryBaseMs ?? 500,
      retryMaxMs: options.retryMaxMs ?? 30_000,
    };
  }

  /**
   * Starts streaming changes that happened after `initialCursor`. Later calls
   * keep the existing connection: page snapshots are reconciled through the
   * document store, so the stream never has to restart on navigation.
   */
  connect(initialCursor: unknown) {
    if (this.cursor === undefined) this.cursor = initialCursor;
    if (this.cursor === undefined || this.socket || this.reconnectTimer) return;
    // After a failure (including a resync) keep backing off so a bad cursor can't cause a tight loop.
    if (this.retryAttempt > 0) this.scheduleOpen(this.backoffDelay());
    else this.open();
  }

  disconnect() {
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    clearTimeout(this.idleTimer);
    const socket = this.socket; this.socket = null;
    socket?.close(1000, "Disconnected");
    this.cursor = undefined;
    this.setStatus("disconnected");
  }

  /** Reconnects immediately if a retry is pending, e.g. when the browser comes back online. */
  retryNow() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    this.open();
  }

  /** Pit team names from the page's server snapshot, for teams that first appear on the feed. */
  getSnapshotNames(): Readonly<Record<string, string>> { return this.snapshotNames; }

  setSnapshotNames(names: Record<string, string>) {
    if (JSON.stringify(names) === JSON.stringify(this.snapshotNames)) return;
    this.snapshotNames = { ...names };
    this.version += 1;
    this.storeListeners.forEach((listener) => listener());
  }

  getCursor() { return this.cursor; }
  getStatus() { return this.status; }
  getVersion() { return this.version; }

  subscribe(listener: () => void): () => void { this.storeListeners.add(listener); return () => { this.storeListeners.delete(listener); }; }
  subscribeStatus(listener: (status: RealtimeStatus) => void): () => void { this.statusListeners.add(listener); listener(this.status); return () => { this.statusListeners.delete(listener); }; }
  /** Fires when the server can no longer resume from our cursor; listeners must reload their snapshot. */
  subscribeResync(listener: () => void): () => void { this.resyncListeners.add(listener); return () => { this.resyncListeners.delete(listener); }; }

  /** Fires when the server ends the connection because the user's session is no longer valid. */
  subscribeSessionEnded(listener: () => void): () => void { this.sessionEndedListeners.add(listener); return () => { this.sessionEndedListeners.delete(listener); }; }

  private setStatus(value: RealtimeStatus) { this.status = value; this.statusListeners.forEach((listener) => listener(value)); }

  private open() {
    if (this.cursor === undefined) return;
    this.setStatus(this.retryAttempt ? "reconnecting" : "connecting");
    let next: SocketLike;
    try { next = this.options.createSocket(this.options.url()); } catch { this.retryAttempt += 1; this.setStatus("reconnecting"); this.scheduleOpen(this.backoffDelay()); return; }
    this.socket = next;
    let ready = false;
    let resync = false;
    const handshakeTimeout = setTimeout(() => { if (next.readyState === CONNECTING) next.close(4000, "Handshake timed out"); }, this.options.handshakeTimeoutMs);
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { if (this.socket === next) next.close(4002, "Realtime feed went quiet"); }, this.options.idleTimeoutMs);
    };

    next.addEventListener("open", () => {
      clearTimeout(handshakeTimeout);
      next.send(JSON.stringify({ type: "subscribe", since: this.cursor }));
      // Browsers only allow close codes 1000 or 3000-4999 from the client side.
      readyTimeout = setTimeout(() => { if (next.readyState === OPEN && !ready) next.close(4001, "Realtime feed did not become ready"); }, this.options.readyTimeoutMs);
    });
    next.addEventListener("message", (event) => {
      if (this.socket !== next) return;
      const message = parseServerMessage(typeof event.data === "string" ? event.data : String(event.data));
      if (!message) { console.warn("Ignoring malformed realtime message"); return; }
      armIdle();
      if (message.type === "ready") {
        ready = true; clearTimeout(readyTimeout);
        this.retryAttempt = 0;
        this.setStatus("connected");
      } else if (message.type === "error") {
        resync = message.resync;
      } else {
        // Advance the cursor only after the change is recorded, so a reconnect
        // resumes from the last event this client actually processed.
        if (message.type === "change" && this.store.apply(message)) {
          this.version += 1;
          this.storeListeners.forEach((listener) => listener());
        }
        this.cursor = message.seq;
      }
    });
    next.addEventListener("close", (event) => {
      clearTimeout(handshakeTimeout); clearTimeout(readyTimeout);
      if (this.socket !== next) return;
      clearTimeout(this.idleTimer);
      this.socket = null;
      if (event.code !== 1000 && event.code !== SERVICE_RESTART) {
        console.warn("Realtime WebSocket closed", { code: event.code, reason: event.reason, wasClean: event.wasClean });
      }
      if (event.code === SESSION_ENDED) {
        // Keep the cursor: after signing in again the page can resume from it.
        this.setStatus("disconnected");
        this.sessionEndedListeners.forEach((listener) => listener());
        return;
      }
      if (resync) {
        // The cursor is unusable; drop everything derived from the feed and let
        // the page supply a fresh snapshot and cursor.
        this.cursor = undefined;
        this.store.clear();
        this.version += 1;
        this.retryAttempt += 1;
        this.setStatus("reconnecting");
        this.storeListeners.forEach((listener) => listener());
        this.resyncListeners.forEach((listener) => listener());
        return;
      }
      this.setStatus("reconnecting");
      if (ready && event.code === SERVICE_RESTART) {
        this.scheduleOpen(Math.random() * this.options.retryBaseMs);
      } else {
        this.retryAttempt += 1;
        this.scheduleOpen(this.backoffDelay());
      }
    });
    // A transport error is always followed by close, which drives the retry.
    next.addEventListener("error", () => {});
  }

  private backoffDelay() {
    const exponential = this.options.retryBaseMs * 2 ** Math.min(this.retryAttempt, 6);
    return Math.min(this.options.retryMaxMs, exponential) + Math.random() * this.options.retryBaseMs;
  }

  private scheduleOpen(delayMs: number) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; this.open(); }, delayMs);
  }
}

/** One connection per browser tab, shared by every component on the page. */
export const realtime = new RealtimeClient();
