import "server-only";
import { enabledProviders, readAuthConfig } from "@/lib/auth/config";
import { authRuntime } from "@/lib/auth/requests";
import { StoreUnavailableError } from "@/lib/auth/store";
import { metricsSnapshot } from "@/lib/ops/metrics";
import { probeSyncGateway, snapshotStatus, type SyncGatewayProbe } from "@/services/couchbase";

export type CheckStatus = "ok" | "degraded" | "down" | "idle" | "unknown" | "unconfigured";
export interface Check { status: CheckStatus; summary: string; checkedAt: number; latencyMs?: number | null; details?: Record<string, unknown> }

const CACHE_MS = 10_000;
const FORCE_FLOOR_MS = 3_000;
/** A connected client's long-poll answers at least every ~25 s; older than this means the feed is stuck. */
const UPSTREAM_STALE_MS = 60_000;

export function serverInfo(now = Date.now()) {
  const startedAt = metricsSnapshot(now).startedAt;
  return {
    version: process.env.APP_VERSION ?? "unknown",
    commit: process.env.APP_BUILD_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || null,
    builtAt: process.env.APP_BUILD_TIME || null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    platform: process.env.VERCEL ? "vercel" : "node",
    nodeVersion: process.version,
    serverTime: new Date(now).toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    uptimeMs: now - startedAt,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

function syncGatewayCheck(probe: SyncGatewayProbe): { syncGateway: Check; couchbase: Check } {
  const at = probe.checkedAt;
  if (!probe.configured) {
    const off: Check = { status: "unconfigured", summary: "COUCHBASE_* settings are missing", checkedAt: at };
    return { syncGateway: off, couchbase: off };
  }
  const syncGateway: Check = !probe.reachable
    ? { status: "down", summary: probe.error ?? "Unreachable", checkedAt: at, latencyMs: probe.latencyMs }
    : !probe.databaseOk
      ? { status: "degraded", summary: probe.error ?? "Database did not answer", checkedAt: at, latencyMs: probe.latencyMs, details: { version: probe.version } }
      : { status: (probe.latencyMs ?? 0) > 2_000 ? "degraded" : "ok", summary: `${probe.version ?? "Sync Gateway"} answered in ${probe.latencyMs} ms`, checkedAt: at, latencyMs: probe.latencyMs, details: { version: probe.version, updateSeq: probe.updateSeq } };
  // The app reaches Couchbase Server only through Sync Gateway; its database state reflects the bucket connection.
  const couchbase: Check = !probe.databaseOk
    ? { status: "unknown", summary: "Cannot tell: Sync Gateway's database did not answer", checkedAt: at }
    : { status: probe.state === "Online" ? "ok" : "degraded", summary: `Database state "${probe.state ?? "unknown"}" (reported by Sync Gateway)`, checkedAt: at, details: { state: probe.state, updateSeq: probe.updateSeq } };
  return { syncGateway, couchbase };
}

async function accountStoreCheck(): Promise<Check> {
  const runtime = authRuntime();
  const checkedAt = Date.now();
  if (!runtime.ok) return { status: "unconfigured", summary: runtime.problems[0], checkedAt, details: { problems: runtime.problems } };
  try {
    const info = await runtime.store.info();
    return { status: info.state === "Online" ? (info.latencyMs > 2_000 ? "degraded" : "ok") : "degraded", summary: `Database state "${info.state}", ${info.latencyMs} ms`, checkedAt, latencyMs: info.latencyMs, details: { state: info.state } };
  } catch (error) {
    return { status: "down", summary: error instanceof StoreUnavailableError ? error.message : "Account store check failed", checkedAt };
  }
}

function realtimeCheck(now: number): Check {
  const { realtime, upstream } = metricsSnapshot(now);
  const details = { activeConnections: realtime.activeConnections, lastUpstreamOkAt: upstream.lastPollOkAt ?? null, lastUpstreamErrorAt: upstream.lastPollErrorAt ?? null };
  const recentError = upstream.lastPollErrorAt !== undefined && (upstream.lastPollOkAt === undefined || upstream.lastPollErrorAt > upstream.lastPollOkAt);
  if (realtime.activeConnections === 0) {
    return { status: recentError ? "degraded" : "idle", summary: recentError ? `No clients connected; the last feed request failed (${upstream.lastPollError})` : "No clients connected, so there is nothing to measure. Run the WebSocket self-test.", checkedAt: now, details };
  }
  if (recentError) return { status: "degraded", summary: `Last upstream feed request failed: ${upstream.lastPollError}`, checkedAt: now, details };
  const fresh = upstream.lastPollOkAt !== undefined && now - upstream.lastPollOkAt < UPSTREAM_STALE_MS;
  return fresh
    ? { status: "ok", summary: `${realtime.activeConnections} client${realtime.activeConnections === 1 ? "" : "s"} connected; feed answered ${Math.round((now - upstream.lastPollOkAt!) / 1000)} s ago`, checkedAt: now, details }
    : { status: "degraded", summary: "Clients are connected but the upstream feed has not answered in over a minute", checkedAt: now, details };
}

function authCheck(store: Check): Check {
  const result = readAuthConfig();
  const now = Date.now();
  if (!result.ok) return { status: "unconfigured", summary: result.problems[0], checkedAt: now, details: { problems: result.problems } };
  const { auth } = metricsSnapshot(now);
  const providers = enabledProviders(result);
  // AUTH_OIDC_ENDPOINT_OVERRIDE is for tests and local development only; make it impossible to miss elsewhere.
  const override = result.config.endpointOverride ? ` (TEST provider endpoints at ${result.config.endpointOverride}; unset AUTH_OIDC_ENDPOINT_OVERRIDE in production)` : "";
  const details = { providers, testEndpoints: Boolean(override), signIns: auth.signIns, signInFailures: auth.signInFailures, lastSignInAt: auth.lastSignInAt ?? null, lastFailureAt: auth.lastFailureAt ?? null, lastFailure: auth.lastFailure ?? null };
  if (store.status === "down") return { status: "down", summary: "Sessions cannot be checked: the account store is down", checkedAt: now, details };
  const failingLately = auth.lastFailureAt !== undefined && (auth.lastSignInAt === undefined || auth.lastFailureAt > auth.lastSignInAt) && now - auth.lastFailureAt < 15 * 60_000;
  return { status: failingLately ? "degraded" : "ok", summary: failingLately ? `Most recent sign-in failed: ${auth.lastFailure}` : `${providers.map((id) => (id === "google" ? "Google" : "Apple")).join(" and ")} sign-in enabled${override}`, checkedAt: now, details };
}

async function runChecks() {
  const started = Date.now();
  const [probe, store] = await Promise.all([probeSyncGateway(), accountStoreCheck()]);
  const now = Date.now();
  const { syncGateway, couchbase } = syncGatewayCheck(probe);
  const { http, errors } = metricsSnapshot(now);
  const recent5xx = errors.filter((error) => now - error.at < 5 * 60_000).length;
  const api: Check = { status: recent5xx > 0 ? "degraded" : "ok", summary: recent5xx > 0 ? `${recent5xx} server error${recent5xx === 1 ? "" : "s"} in the last 5 minutes` : "Answering; no server errors in the last 5 minutes", checkedAt: now, latencyMs: now - started, details: { requests: http.measured ? http.requests : null } };
  return {
    checkedAt: now,
    checks: { api, syncGateway, couchbase, accountStore: store, realtime: realtimeCheck(now), auth: authCheck(store) },
    snapshot: snapshotStatus(),
  };
}

type Checks = Awaited<ReturnType<typeof runChecks>>;
const CACHE_KEY = Symbol.for("610-scouting.health-cache");
type HealthCache = { value?: Checks; inFlight?: Promise<Checks> };
const healthCache = (): HealthCache => ((globalThis as Record<symbol, unknown>)[CACHE_KEY] ??= {}) as HealthCache;

/** Health checks, cached for 10 s so several open admin tabs do not multiply the load on Sync Gateway. */
export async function getHealth(options: { force?: boolean } = {}): Promise<Checks> {
  const state = healthCache();
  const age = state.value ? Date.now() - state.value.checkedAt : Infinity;
  if (state.value && (age < (options.force ? FORCE_FLOOR_MS : CACHE_MS))) {
    // Realtime and auth are in-process numbers: always current.
    return { ...state.value, checks: { ...state.value.checks, realtime: realtimeCheck(Date.now()), auth: authCheck(state.value.checks.accountStore) } };
  }
  state.inFlight ??= runChecks().finally(() => { state.inFlight = undefined; });
  state.value = await state.inFlight;
  return state.value;
}

export function overallStatus(checks: Record<string, Check>): CheckStatus {
  const statuses = Object.values(checks).map((check) => check.status);
  if (statuses.includes("down")) return "down";
  if (statuses.some((status) => status === "degraded" || status === "unconfigured" || status === "unknown")) return "degraded";
  return "ok";
}

/**
 * Proves the account store persists data: writes a diagnostic document, reads
 * it back, compares, and deletes it. Scouting data is never written.
 */
export async function persistenceRoundTrip(): Promise<Check> {
  const runtime = authRuntime();
  const checkedAt = Date.now();
  if (!runtime.ok) return { status: "unconfigured", summary: runtime.problems[0], checkedAt };
  const id = `diag_${checkedAt}_${Math.random().toString(16).slice(2, 10)}`;
  const marker = Math.random().toString(36).slice(2);
  const started = Date.now();
  try {
    const rev = await runtime.store.create(id, { type: "diagnostic", marker, at: new Date(checkedAt).toISOString() });
    const read = await runtime.store.get<{ marker?: string }>(id);
    await runtime.store.remove(id, read?.rev ?? rev);
    const latencyMs = Date.now() - started;
    return read?.body.marker === marker
      ? { status: "ok", summary: `Wrote, read back, and deleted a document in ${latencyMs} ms`, checkedAt, latencyMs }
      : { status: "down", summary: "The document read back did not match what was written", checkedAt, latencyMs };
  } catch (error) {
    return { status: "down", summary: error instanceof Error ? error.message : "Round trip failed", checkedAt, latencyMs: Date.now() - started };
  }
}
