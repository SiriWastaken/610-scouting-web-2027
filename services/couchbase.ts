// The Sync Gateway implementation of ScoutingStore: reads documents through one cached snapshot, projects them
// to the privacy allow-list, and probes Sync Gateway for health.
import "server-only";
import { projectDashboardDocument } from "@/lib/realtime/protocol";
import { getCouchbaseChangesConfig, readCouchbaseConfig } from "@/lib/data/couchbase-config";
import type { TeamAggregate } from "@/types/scouting";
import { getDocumentTeam, getDocumentTeamName, normalizeAggregateDocument } from "@/lib/data/aggregates";
import { appConfig } from "@/app.config";
import { recordSnapshot } from "@/lib/ops/metrics";
import { describeFetchError } from "@/lib/realtime/couchbase-feed";

interface CouchbaseDocument {
  _id?: string;
  timestamp?: string;
  type?: string;
  team?: number | string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

type CouchbaseConfig = NonNullable<ReturnType<typeof readCouchbaseConfig>>;

/** The same database URL the realtime feed uses (ws: -> http:, wss: -> https:). */
function collectionUrl(config: CouchbaseConfig): string {
  return getCouchbaseChangesConfig(config)!.url.replace(/\/_changes$/, "");
}

/** Upper bound on a snapshot request, so an unresponsive Sync Gateway cannot hang page rendering. */
function requestTimeoutMs(): number {
  const configured = Number(process.env.COUCHBASE_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 15_000;
}

type DocumentSnapshot = { documents: CouchbaseDocument[]; lastSeq: unknown };
let snapshotCache: { value: DocumentSnapshot; expiresAt: number } | undefined;
let snapshotInFlight: Promise<DocumentSnapshot> | undefined;
const SNAPSHOT_CACHE_MS = appConfig.storage.snapshotCacheMs;

async function getCachedSnapshot(config: CouchbaseConfig): Promise<DocumentSnapshot> {
  if (snapshotCache && snapshotCache.expiresAt > Date.now()) return snapshotCache.value;
  if (snapshotInFlight) return snapshotInFlight;
  const started = Date.now();
  snapshotInFlight = fetchAllDocuments(config);
  try {
    const value = await snapshotInFlight;
    snapshotCache = { value, expiresAt: Date.now() + SNAPSHOT_CACHE_MS };
    recordSnapshot({ ok: true, durationMs: Date.now() - started, documents: value.documents.length, byKind: countByKind(value.documents), lastSeq: value.lastSeq });
    return value;
  } catch (error) {
    recordSnapshot({ ok: false, error: new Error(describeFetchError(error)) });
    throw error;
  } finally {
    snapshotInFlight = undefined;
  }
}

/** Document counts by id family, for the admin panel's sync view. */
function countByKind(documents: CouchbaseDocument[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const document of documents) {
    const id = document._id ?? "";
    const kind = /^aggregate_/.test(id) ? "aggregate" : /^scouting_/.test(id) ? "scouting" : /^pit_/.test(id) ? "pit" : /^report_/.test(id) ? "report" : "other";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

async function fetchAllDocuments(config: CouchbaseConfig): Promise<{ documents: CouchbaseDocument[]; lastSeq: unknown }> {
  const response = await fetch(`${collectionUrl(config)}/_changes?include_docs=true&style=all_docs`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });

  if (!response.ok) {
    throw new Error(`Couchbase _changes request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { results?: Array<{ id?: string; doc?: CouchbaseDocument; deleted?: boolean }>; last_seq?: unknown };
  const documents = (payload.results ?? [])
    .filter((row) => row.doc && !row.deleted && !row.id?.startsWith("_"))
    .map((row) => ({ ...row.doc, _id: row.doc?._id ?? row.id }));
  return { documents, lastSeq: payload.last_seq ?? 0 };
}

/** One team's documents of one kind from the snapshot, reduced to the privacy allow-list. */
export async function queryDashboardDocuments(kind: "matches" | "pit" | "reports", teamNumber: number): Promise<{ _default: Record<string, unknown> }[]> {
  const config = readCouchbaseConfig();
  if (!config || !Number.isSafeInteger(teamNumber) || teamNumber <= 0) return [];
  try {
    const { documents } = await getCachedSnapshot(config);
    return documents.flatMap((document) => {
      const id = document._id;
      if (!id) return [];
      const isMatch = kind === "matches" && new RegExp(`^scouting_${teamNumber}_\\d+$`).test(id);
      const isPit = kind === "pit" && id === `pit_${teamNumber}`;
      const isReport = kind === "reports" && new RegExp(`^report_(?:card_)?${teamNumber}_[A-Za-z0-9 ._-]{1,128}$`).test(id);
      if (!isMatch && !isPit && !isReport) return [];
      const safe = projectDashboardDocument(id, document);
      return safe ? [{ _default: safe }] : [];
    });
  } catch (error) {
    console.error(`Unable to load ${kind} dashboard documents.`, error);
    return [];
  }
}

/**
 * Team rows plus the feed cursor they were built from. `names` holds every pit
 * team name in the snapshot (including teams with no aggregate yet) so the
 * browser can name teams whose aggregate arrives over the realtime feed.
 */
export async function fetchTeamAggregatesSnapshot(): Promise<{ teams: TeamAggregate[]; lastSeq: unknown; names: Record<string, string> }> {
  const config = readCouchbaseConfig();
  if (!config) return { teams: [], lastSeq: 0, names: {} };

  try {
    const { documents, lastSeq } = await getCachedSnapshot(config);
    const names = pitNames(documents);
    const teams = documents
      .filter((document) => document.type === "aggregate_data")
      // Server-rendered rows are serialised into the page, so they get the same
      // field allow-list as realtime frames: nothing beyond the dashboard statistics.
      .map((document) => typeof document._id === "string" ? projectDashboardDocument(document._id, document) : null)
      .map((document) => document ? normalizeAggregateDocument(document, names) : null)
      .filter((team): team is TeamAggregate => team !== null)
      .sort((left, right) => (left.rank || Number.MAX_SAFE_INTEGER) - (right.rank || Number.MAX_SAFE_INTEGER) || left.team - right.team);
    return { teams, lastSeq, names: Object.fromEntries(names) };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
    console.warn("Unable to fetch team aggregates from Couchbase:", cause ?? (error instanceof Error ? error.message : error));
    return { teams: [], lastSeq: 0, names: {} };
  }
}

function pitNames(documents: CouchbaseDocument[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const document of documents.filter((candidate) => candidate.type === "pit")) {
    // Pit documents are keyed `pit_<team>`; the id wins, as it does for realtime pit changes.
    const idTeam = document._id?.match(/^pit_(\d+)$/)?.[1];
    const team = idTeam ? Number(idTeam) : getDocumentTeam(document);
    const name = getDocumentTeamName(document);
    if (team && name) names.set(team, name);
  }
  return names;
}

/** What asking Sync Gateway directly found: reachable, database state, version, latency. */
export interface SyncGatewayProbe {
  configured: boolean;
  /** Sync Gateway answered its root endpoint. */
  reachable: boolean;
  /** The configured database answered with our credentials. */
  databaseOk: boolean;
  /** `state` from `GET /{db}/` ("Online" when Sync Gateway is connected to its Couchbase bucket). */
  state: string | null;
  version: string | null;
  updateSeq: string | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: number;
}

/**
 * Asks Sync Gateway directly, rather than inferring health from page loads:
 * `GET /` (is the server up, which version) and `GET /{db}/` (does our
 * database answer with our credentials, and is it Online).
 */
export async function probeSyncGateway(): Promise<SyncGatewayProbe> {
  const config = readCouchbaseConfig();
  const checkedAt = Date.now();
  const empty = { reachable: false, databaseOk: false, state: null, version: null, updateSeq: null, latencyMs: null };
  if (!config) return { configured: false, ...empty, error: "COUCHBASE_* settings are missing", checkedAt };
  const database = collectionUrl(config);
  const root = new URL(database).origin;
  const started = Date.now();
  try {
    const rootResponse = await fetch(`${root}/`, { cache: "no-store", signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" } });
    const rootBody = await rootResponse.json().catch(() => ({})) as { version?: unknown; vendor?: { version?: unknown } };
    const version = typeof rootBody.version === "string" ? rootBody.version.slice(0, 80) : typeof rootBody.vendor?.version === "string" ? rootBody.vendor.version.slice(0, 40) : null;
    const dbResponse = await fetch(`${database}/`, {
      cache: "no-store", signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}` },
    });
    const latencyMs = Date.now() - started;
    const dbBody = await dbResponse.json().catch(() => ({})) as { state?: unknown; update_seq?: unknown };
    return {
      configured: true, reachable: true, databaseOk: dbResponse.ok, version, latencyMs, checkedAt,
      state: typeof dbBody.state === "string" ? dbBody.state.slice(0, 40) : null,
      updateSeq: dbBody.update_seq === undefined ? null : String(dbBody.update_seq).slice(0, 40),
      error: dbResponse.ok ? null : `Database request returned HTTP ${dbResponse.status}`,
    };
  } catch (error) {
    return { configured: true, ...empty, latencyMs: Date.now() - started, error: error instanceof Error && error.name === "TimeoutError" ? "Timed out after 5 s" : "Sync Gateway is unreachable", checkedAt };
  }
}

/** Snapshot age and document counts as last fetched (does not fetch). */
export function snapshotStatus() {
  return snapshotCache ? { cachedUntil: snapshotCache.expiresAt, documents: snapshotCache.value.documents.length, byKind: countByKind(snapshotCache.value.documents), lastSeq: String(snapshotCache.value.lastSeq).slice(0, 40) } : null;
}

/**
 * Scouting submissions per scout name, from the server snapshot: how many
 * match records name each scout and when the latest was made. Matches on the
 * `scoutName` field scouting tablets write; names never leave the admin API.
 */
export async function scoutActivity(): Promise<Map<string, { submissions: number; lastSubmittedAt: string | null }>> {
  const config = readCouchbaseConfig();
  const activity = new Map<string, { submissions: number; lastSubmittedAt: string | null }>();
  if (!config) return activity;
  try {
    const { documents } = await getCachedSnapshot(config);
    for (const document of documents) {
      if (!document._id?.startsWith("scouting_")) continue;
      const data = document.data && typeof document.data === "object" ? document.data as Record<string, unknown> : {};
      const start = data.start && typeof data.start === "object" ? data.start as Record<string, unknown> : {};
      const name = [start.scoutName, data.scoutName, document.scoutName].find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (!name) continue;
      const key = name.trim().toLowerCase();
      const entry = activity.get(key) ?? { submissions: 0, lastSubmittedAt: null };
      entry.submissions += 1;
      const at = typeof document.timestamp === "string" ? document.timestamp : null;
      if (at && (!entry.lastSubmittedAt || at > entry.lastSubmittedAt)) entry.lastSubmittedAt = at;
      activity.set(key, entry);
    }
  } catch (error) {
    console.error("Unable to compute scout activity.", error);
  }
  return activity;
}
