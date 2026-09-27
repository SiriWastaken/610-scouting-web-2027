import "server-only";
import { projectDashboardDocument } from "@/lib/realtime-protocol";
import { getCouchbaseChangesConfig as makeChangesConfig, readCouchbaseConfig } from "@/lib/couchbase-config";
import type { TeamAggregate } from "@/types/scouting";
import { getDocumentTeam, getDocumentTeamName, normalizeAggregateDocument } from "@/lib/normalize-aggregate";

interface CouchbaseDocument {
  _id?: string;
  timestamp?: string;
  type?: string;
  team?: number | string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

type CouchbaseConfig = NonNullable<ReturnType<typeof readCouchbaseConfig>>;

export function getCouchbaseChangesConfig() {
  return makeChangesConfig();
}

function getConfig(): CouchbaseConfig | null {
  return readCouchbaseConfig();
}

function collectionUrl(config: CouchbaseConfig): string {
  const baseUrl = config.baseUrl.replace(/^wss?:\/\//, "https://").replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(config.database)}`;
}

type DocumentSnapshot = { documents: CouchbaseDocument[]; lastSeq: unknown };
let snapshotCache: { value: DocumentSnapshot; expiresAt: number } | undefined;
let snapshotInFlight: Promise<DocumentSnapshot> | undefined;
const SNAPSHOT_CACHE_MS = 20_000;

async function getCachedSnapshot(config: CouchbaseConfig): Promise<DocumentSnapshot> {
  if (snapshotCache && snapshotCache.expiresAt > Date.now()) return snapshotCache.value;
  if (snapshotInFlight) return snapshotInFlight;
  snapshotInFlight = fetchAllDocuments(config);
  try {
    const value = await snapshotInFlight;
    snapshotCache = { value, expiresAt: Date.now() + SNAPSHOT_CACHE_MS };
    return value;
  } finally {
    snapshotInFlight = undefined;
  }
}

async function fetchAllDocuments(config: CouchbaseConfig): Promise<{ documents: CouchbaseDocument[]; lastSeq: unknown }> {
  const response = await fetch(`${collectionUrl(config)}/_changes?include_docs=true&style=all_docs`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      Accept: "application/json",
    },
    cache: "no-store",
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

/**
 * Fetches every Couchbase doc whose `type` field matches, wrapped as
 * `{ _default: doc }` so callers can pull the raw doc via `r._default`
 * (this matches the shape CardReportsTable / TeamsClientView expect).
 *
 * e.g. queryDocsByType('report_card'), queryDocsByType('match'), queryDocsByType('pit')
 */
export async function queryDocsByType(type: string): Promise<{ _default: CouchbaseDocument }[]> {
  const config = getConfig();
  if (!config) return [];

  try {
    const { documents } = await getCachedSnapshot(config);
    return documents
      .filter((document) => document.type === type)
      .map((document) => ({ _default: document }));
  } catch (error) {
    console.error(`Unable to query Couchbase docs of type "${type}".`, error);
    return [];
  }
}

/**
 * Diagnostic helper: returns every distinct `type` value present in the
 * bucket along with how many docs have it (plus one sample doc per type),
 * so you can find the real name your match-scouting docs use without
 * guessing. Call this from the browser console or a component effect.
 */
export async function listDocumentTypes(): Promise<
  { type: string; count: number; sample: CouchbaseDocument }[]
> {
  const config = getConfig();
  if (!config) return [];

  try {
    const { documents } = await getCachedSnapshot(config);
    const byType = new Map<string, { count: number; sample: CouchbaseDocument }>();

    documents.forEach((document) => {
      const key = document.type ?? '(no type field)';
      const existing = byType.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byType.set(key, { count: 1, sample: document });
      }
    });

    return Array.from(byType.entries())
      .map(([type, { count, sample }]) => ({ type, count, sample }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error('Unable to list Couchbase document types.', error);
    return [];
  }
}

/**
 * Fetches every doc whose `_id` starts with the given prefix, wrapped as
 * `{ _default: doc }`. Your scouting docs are keyed like
 * `scouting_<teamNumber>_<matchNumber>` rather than by a `type` field, so
 * this is how TeamsClientView finds match entries — `queryDocsByIdPrefix('scouting_')`.
 */
export async function queryDocsByIdPrefix(prefix: string): Promise<{ _default: CouchbaseDocument }[]> {
  const config = getConfig();
  if (!config) return [];

  try {
    const { documents } = await getCachedSnapshot(config);
    return documents
      .filter((document) => typeof document._id === 'string' && document._id.startsWith(prefix))
      .map((document) => ({ _default: document }));
  } catch (error) {
    console.error(`Unable to query Couchbase docs with id prefix "${prefix}".`, error);
    return [];
  }
}

export async function queryDashboardDocuments(kind: "matches" | "pit" | "reports", teamNumber: number): Promise<{ _default: Record<string, unknown> }[]> {
  const config = getConfig();
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

export async function fetchTeamAggregates(): Promise<TeamAggregate[]> {
  return (await fetchTeamAggregatesSnapshot()).teams;
}

export async function fetchTeamAggregatesSnapshot(): Promise<{ teams: TeamAggregate[]; lastSeq: unknown }> {
  const config = getConfig();
  if (!config) return { teams: [], lastSeq: 0 };

  try {
    const { documents, lastSeq } = await getCachedSnapshot(config);
    const names = new Map<number, string>();

    documents
      .filter((document) => document.type === "pit")
      .forEach((document) => {
        const team = getDocumentTeam(document);
        const name = getDocumentTeamName(document);
        if (team && name) names.set(team, name);
      });

    const teams = documents
      .filter((document) => document.type === "aggregate_data")
      .map((document) => normalizeAggregateDocument(document, names))
      .filter((team): team is TeamAggregate => team !== null)
      .sort((left, right) => (left.rank || Number.MAX_SAFE_INTEGER) - (right.rank || Number.MAX_SAFE_INTEGER) || left.team - right.team);
    return { teams, lastSeq };
  } catch (error) {
    console.error("Unable to fetch team aggregates from Couchbase.", error);
    return { teams: [], lastSeq: 0 };
  }
}
