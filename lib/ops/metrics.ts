// In-process operational counters for the admin panel: realtime connections and
// events, the upstream changes feed, HTTP traffic, authentication, and recent
// errors. Everything is measured where it happens; nothing is estimated.
//
// The registry lives on globalThis because scripts/server.mjs (plain Node) and
// Next.js route handlers (bundled) load separate copies of this module in the
// same process; a module-level variable would split the numbers between them.
// Numbers are per server process: on a platform that runs several instances
// each instance reports its own (see docs/16-operations.md).

const RING = { events: 200, errors: 50, durations: 200, latencies: 500 };
const RECONNECT_WINDOW_MS = 60_000;

interface RealtimeEvent { at: number; type: string; connection?: number; detail?: string }
interface ErrorEntry { at: number; source: string; message: string; path?: string }
interface ActiveConnection { id: number; openedAt: number; userId?: string; role?: string; subscribedAt?: number; since?: string; framesSent: number; changesSent: number; lastFrameAt?: number }

interface Registry {
  startedAt: number;
  nextConnectionId: number;
  realtime: {
    active: Map<number, ActiveConnection>;
    opened: number; closed: number; reconnects: number;
    rejected: Record<"origin" | "auth" | "capacity" | "unconfigured", number>;
    invalidSubscriptions: number; subscriptionTimeouts: number; sessionEnded: number;
    feedErrors: number; resyncs: number; sendErrors: number;
    framesSent: number; changesSent: number;
    lastChangeAt?: number; lastChangeId?: string; lastSeq?: string;
    durations: number[];
    events: RealtimeEvent[];
    lastDisconnectByUser: Map<string, number>;
  };
  upstream: { polls: number; pollErrors: number; lastPollOkAt?: number; lastPollErrorAt?: number; lastPollError?: string; uniqueChanges: number; lastUniqueSeq?: string };
  http: { measured: boolean; requests: number; byClass: Record<"2xx" | "3xx" | "4xx" | "5xx", number>; lastRequestAt?: number; latencies: number[]; routes: Map<string, { count: number; errors: number; totalMs: number }> };
  auth: { signIns: number; signInFailures: number; disabledSignIns: number; signOuts: number; sessionRejections: number; lastSignInAt?: number; lastFailureAt?: number; lastFailure?: string };
  snapshot: { fetches: number; failures: number; lastOkAt?: number; lastErrorAt?: number; lastError?: string; durationMs?: number; documents?: number; byKind?: Record<string, number>; lastSeq?: string };
  store: { requests: number; failures: number; lastOkAt?: number; lastErrorAt?: number; lastError?: string; lastLatencyMs?: number };
  errors: ErrorEntry[];
}

const KEY = Symbol.for("610-scouting.ops-metrics");
type GlobalWithRegistry = typeof globalThis & { [KEY]?: Registry };

function fresh(): Registry {
  return {
    startedAt: Date.now(), nextConnectionId: 1,
    realtime: { active: new Map(), opened: 0, closed: 0, reconnects: 0, rejected: { origin: 0, auth: 0, capacity: 0, unconfigured: 0 }, invalidSubscriptions: 0, subscriptionTimeouts: 0, sessionEnded: 0, feedErrors: 0, resyncs: 0, sendErrors: 0, framesSent: 0, changesSent: 0, durations: [], events: [], lastDisconnectByUser: new Map() },
    upstream: { polls: 0, pollErrors: 0, uniqueChanges: 0 },
    http: { measured: false, requests: 0, byClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 }, latencies: [], routes: new Map() },
    auth: { signIns: 0, signInFailures: 0, disabledSignIns: 0, signOuts: 0, sessionRejections: 0 },
    snapshot: { fetches: 0, failures: 0 },
    store: { requests: 0, failures: 0 },
    errors: [],
  };
}

function registry(): Registry {
  const holder = globalThis as GlobalWithRegistry;
  return (holder[KEY] ??= fresh());
}

/** Tests only: start from zero. */
export function resetMetrics() { (globalThis as GlobalWithRegistry)[KEY] = fresh(); }

const push = <T>(ring: T[], value: T, size: number) => { ring.push(value); if (ring.length > size) ring.splice(0, ring.length - size); };

/** Removes anything that could be a credential or an internal address from a message before it is kept. */
export function scrub(message: unknown): string {
  const text = message instanceof Error ? message.message : typeof message === "string" ? message : String(message);
  return text
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]+/gi, "$1 [redacted]")
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, "//[redacted]@")
    .replace(/\b(password|secret|token|code|authorization)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 300);
}

/** Remembers a server error for the admin panel (message scrubbed of secrets). */
export function recordError(source: string, error: unknown, path?: string) {
  push(registry().errors, { at: Date.now(), source, message: scrub(error), ...(path ? { path: path.slice(0, 200) } : {}) }, RING.errors);
}

// ── Realtime ────────────────────────────────────────────────────────────────

function realtimeEvent(type: string, connection?: number, detail?: string) {
  push(registry().realtime.events, { at: Date.now(), type, ...(connection ? { connection } : {}), ...(detail ? { detail: scrub(detail) } : {}) }, RING.events);
}

/** Counters and a recent-events log for WebSocket connections. Per server process. */
export const realtimeMetrics = {
  rejected(reason: keyof Registry["realtime"]["rejected"]) {
    registry().realtime.rejected[reason] += 1;
    realtimeEvent(`rejected:${reason}`);
  },
  opened(identity: { userId?: string; role?: string } = {}): number {
    const state = registry();
    const id = state.nextConnectionId++;
    state.realtime.opened += 1;
    state.realtime.active.set(id, { id, openedAt: Date.now(), framesSent: 0, changesSent: 0, ...identity });
    // A new connection from someone who dropped less than a minute ago is a reconnect.
    const lastDrop = identity.userId ? state.realtime.lastDisconnectByUser.get(identity.userId) : undefined;
    const reconnect = lastDrop !== undefined && Date.now() - lastDrop < RECONNECT_WINDOW_MS;
    if (reconnect) state.realtime.reconnects += 1;
    realtimeEvent(reconnect ? "reconnected" : "connected", id);
    return id;
  },
  subscribed(id: number, since: unknown) {
    const connection = registry().realtime.active.get(id);
    if (!connection) return;
    connection.subscribedAt = Date.now();
    connection.since = typeof since === "string" ? since.slice(0, 40) : JSON.stringify(since)?.slice(0, 40);
    realtimeEvent("subscribed", id, `since ${connection.since}`);
  },
  invalidSubscription(id: number) { registry().realtime.invalidSubscriptions += 1; realtimeEvent("malformed-subscription", id); },
  subscriptionTimeout(id: number) { registry().realtime.subscriptionTimeouts += 1; realtimeEvent("subscription-timeout", id); },
  sessionEnded(id: number) { registry().realtime.sessionEnded += 1; realtimeEvent("session-ended", id); },
  frameSent(id: number, frame: { type: string; id?: string; seq?: unknown }) {
    const state = registry().realtime;
    state.framesSent += 1;
    const connection = state.active.get(id);
    if (connection) { connection.framesSent += 1; connection.lastFrameAt = Date.now(); }
    if (frame.seq !== undefined) state.lastSeq = (typeof frame.seq === "string" ? frame.seq : JSON.stringify(frame.seq)).slice(0, 40);
    if (frame.type === "change") {
      state.changesSent += 1; state.lastChangeAt = Date.now(); state.lastChangeId = frame.id;
      if (connection) connection.changesSent += 1;
      realtimeEvent("change-delivered", id, `${frame.id} @ ${state.lastSeq}`);
    }
  },
  sendError(id: number, error: unknown) { registry().realtime.sendErrors += 1; realtimeEvent("send-error", id, scrub(error)); recordError("realtime", error); },
  feedError(id: number, error: unknown, resync: boolean) {
    const state = registry().realtime;
    state.feedErrors += 1; if (resync) state.resyncs += 1;
    realtimeEvent(resync ? "resync-required" : "feed-error", id, scrub(error));
    recordError("realtime-feed", error);
  },
  closed(id: number, code?: number) {
    const state = registry().realtime;
    const connection = state.active.get(id);
    if (!connection) return;
    state.active.delete(id);
    state.closed += 1;
    push(state.durations, Date.now() - connection.openedAt, RING.durations);
    if (connection.userId) state.lastDisconnectByUser.set(connection.userId, Date.now());
    if (state.lastDisconnectByUser.size > 1000) state.lastDisconnectByUser.clear();
    realtimeEvent("disconnected", id, code ? `code ${code}` : undefined);
  },
};

/** Called for every upstream `_changes` response relayed by any connection. */
export function recordUpstreamPoll(ok: boolean, detail?: { error?: unknown; lastSeq?: unknown }) {
  const upstream = registry().upstream;
  if (ok) {
    upstream.polls += 1; upstream.lastPollOkAt = Date.now();
    const seq = detail?.lastSeq === undefined ? undefined : String(typeof detail.lastSeq === "string" ? detail.lastSeq : JSON.stringify(detail.lastSeq)).slice(0, 40);
    // Every connection polls separately; count each database sequence once.
    if (seq && seq !== upstream.lastUniqueSeq && (upstream.lastUniqueSeq === undefined || Number(seq) > Number(upstream.lastUniqueSeq) || Number.isNaN(Number(seq)))) {
      if (upstream.lastUniqueSeq !== undefined) upstream.uniqueChanges += 1;
      upstream.lastUniqueSeq = seq;
    }
  } else {
    upstream.pollErrors += 1; upstream.lastPollErrorAt = Date.now(); upstream.lastPollError = scrub(detail?.error ?? "unknown error");
  }
}

// ── HTTP (recorded by scripts/server.mjs; not available on Vercel) ────────────

export function routeKey(path: string): string {
  const pathname = path.split("?")[0] || "/";
  if (pathname.startsWith("/_next/")) return "/_next/*";
  return pathname
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    .replace(/\/u[0-9a-f]{20}(?=\/|$)/g, "/:id")
    .slice(0, 80);
}

/** Counts one HTTP request by route class and status, and its latency. */
export function recordHttpRequest(method: string, path: string, status: number, durationMs: number) {
  const http = registry().http;
  http.measured = true;
  http.requests += 1; http.lastRequestAt = Date.now();
  const statusClass = status >= 500 ? "5xx" : status >= 400 ? "4xx" : status >= 300 ? "3xx" : "2xx";
  http.byClass[statusClass] += 1;
  const key = `${method} ${routeKey(path)}`;
  if (!key.endsWith("/_next/*")) push(http.latencies, durationMs, RING.latencies);
  const route = http.routes.get(key) ?? { count: 0, errors: 0, totalMs: 0 };
  route.count += 1; route.totalMs += durationMs; if (status >= 500) route.errors += 1;
  if (http.routes.size < 200 || http.routes.has(key)) http.routes.set(key, route);
}

// ── Auth, snapshot, account store ────────────────────────────────────────────

export const authMetrics = {
  signIn() { const auth = registry().auth; auth.signIns += 1; auth.lastSignInAt = Date.now(); },
  signInFailed(reason: string) { const auth = registry().auth; auth.signInFailures += 1; auth.lastFailureAt = Date.now(); auth.lastFailure = scrub(reason); },
  disabledSignIn() { registry().auth.disabledSignIns += 1; },
  signOut() { registry().auth.signOuts += 1; },
  sessionRejected() { registry().auth.sessionRejections += 1; },
};

/** Records the outcome of a server snapshot fetch. */
export function recordSnapshot(result: { ok: true; durationMs: number; documents: number; byKind: Record<string, number>; lastSeq: unknown } | { ok: false; error: unknown }) {
  const snapshot = registry().snapshot;
  snapshot.fetches += 1;
  if (result.ok) {
    snapshot.lastOkAt = Date.now(); snapshot.durationMs = result.durationMs; snapshot.documents = result.documents; snapshot.byKind = result.byKind;
    snapshot.lastSeq = String(typeof result.lastSeq === "string" ? result.lastSeq : JSON.stringify(result.lastSeq)).slice(0, 40);
  } else {
    snapshot.failures += 1; snapshot.lastErrorAt = Date.now(); snapshot.lastError = scrub(result.error);
    recordError("couchbase-snapshot", result.error);
  }
}

/** Records the outcome and latency of an account-store request. */
export function recordStoreRequest(ok: boolean, latencyMs: number, error?: unknown) {
  const store = registry().store;
  store.requests += 1; store.lastLatencyMs = latencyMs;
  if (ok) store.lastOkAt = Date.now();
  else { store.failures += 1; store.lastErrorAt = Date.now(); store.lastError = scrub(error); recordError("account-store", error); }
}

// ── Read side ───────────────────────────────────────────────────────────────

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
}

/** A JSON-safe copy of everything, for the admin API. Contains no credentials or document contents. */
export function metricsSnapshot(now = Date.now()) {
  const state = registry();
  const { realtime, http } = state;
  return {
    startedAt: state.startedAt,
    realtime: {
      activeConnections: realtime.active.size,
      connections: [...realtime.active.values()].map((connection) => ({ ...connection, ageMs: now - connection.openedAt })),
      opened: realtime.opened, closed: realtime.closed, reconnects: realtime.reconnects,
      rejected: { ...realtime.rejected },
      invalidSubscriptions: realtime.invalidSubscriptions, subscriptionTimeouts: realtime.subscriptionTimeouts, sessionEnded: realtime.sessionEnded,
      feedErrors: realtime.feedErrors, resyncs: realtime.resyncs, sendErrors: realtime.sendErrors,
      framesSent: realtime.framesSent, changesSent: realtime.changesSent,
      lastChangeAt: realtime.lastChangeAt ?? null, lastChangeId: realtime.lastChangeId ?? null, lastSeq: realtime.lastSeq ?? null,
      durationMs: { p50: percentile(realtime.durations, 50), p95: percentile(realtime.durations, 95), samples: realtime.durations.length },
      events: [...realtime.events].reverse(),
    },
    upstream: { ...state.upstream },
    http: {
      measured: http.measured, requests: http.requests, byClass: { ...http.byClass }, lastRequestAt: http.lastRequestAt ?? null,
      latencyMs: { p50: percentile(http.latencies, 50), p95: percentile(http.latencies, 95), p99: percentile(http.latencies, 99), samples: http.latencies.length },
      routes: [...http.routes.entries()].map(([route, value]) => ({ route, count: value.count, errors: value.errors, avgMs: Math.round(value.totalMs / value.count) })).sort((a, b) => b.count - a.count).slice(0, 25),
    },
    auth: { ...state.auth },
    snapshot: { ...state.snapshot },
    store: { ...state.store },
    errors: [...state.errors].reverse(),
  };
}
/** Everything the admin panel shows from counters, as plain data. */
export type MetricsSnapshot = ReturnType<typeof metricsSnapshot>;
