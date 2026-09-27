import type { TeamAggregate } from "@/types/scouting";

interface CouchbaseDocument {
  _id?: string;
  timestamp?: string;
  type?: string;
  team?: number | string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CouchbaseConfig {
  baseUrl: string;
  database: string;
  username: string;
  password: string;
  scope: string;
  collection: string;
}

function getConfig(): CouchbaseConfig | null {
  const values = {
    baseUrl: 'wss://iwtskh1-eltt8mf7.apps.cloud.couchbase.com:4984',
    database: "scoutingapp2026",
    username: "FRC610",
    password: 'FRCTeam61)',
    scope: "_default",
    collection: "_default",
    test: "testValue"
  };

  if (!values.baseUrl || !values.database || !values.username || !values.password) {
    return null;
  }

  return values as CouchbaseConfig;
}

function collectionUrl(config: CouchbaseConfig): string {
  const baseUrl = config.baseUrl.replace(/^wss?:\/\//, "https://").replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(config.database)}`;
}

async function fetchAllDocuments(config: CouchbaseConfig): Promise<CouchbaseDocument[]> {
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

  const payload = (await response.json()) as { results?: Array<{ id?: string; doc?: CouchbaseDocument; deleted?: boolean }> };
  return (payload.results ?? [])
    .filter((row) => row.doc && !row.deleted && !row.id?.startsWith("_"))
    .map((row) => ({ ...row.doc, _id: row.doc?._id ?? row.id }));
}

function asNumber(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function asPercentage(value: unknown, fallback = 0): number {
  return Math.round(asNumber(value, fallback));
}

function teamNumber(document: CouchbaseDocument): number {
  return asNumber(document.team ?? document.data?.team ?? document.data?.teamNumber);
}

function teamName(document: CouchbaseDocument): string | undefined {
  const data = document.data ?? document;
  const value = data.teamName ?? data.team_name ?? data.name;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAggregate(document: CouchbaseDocument, names: Map<number, string>): TeamAggregate | null {
  const data = document.data;
  if (!data) return null;

  const team = teamNumber({ ...document, data });
  if (!team) return null;

  return {
    team,
    name: names.get(team) ?? `Team ${team}`,
    recordedAt: document.timestamp,
    sourceId: document._id,
    rawData: data,
    rank: asNumber(data.standing),
    matches: asNumber(data.matchesPlayed),
    autoPpg: asNumber(data.autoPPG),
    teleopPpg: asNumber(data.teleopPPG),
    endgamePpg: asNumber(data.endgamePPG),
    fuelPerMatch: asNumber(data.fuelscored),
    fuelAccuracy: asPercentage(data.teleopFuelaccuracy ?? data.autoFuelaccuracy),
    defenseRating: asNumber(data.avgDefenseSkill),
    driverSkill: asNumber(data.avgDriverSkill),
    breakRate: asPercentage(data.brokePercentage),
  };
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
    const documents = await fetchAllDocuments(config);
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
    const documents = await fetchAllDocuments(config);
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
    const documents = await fetchAllDocuments(config);
    return documents
      .filter((document) => typeof document._id === 'string' && document._id.startsWith(prefix))
      .map((document) => ({ _default: document }));
  } catch (error) {
    console.error(`Unable to query Couchbase docs with id prefix "${prefix}".`, error);
    return [];
  }
}

export async function fetchTeamAggregates(): Promise<TeamAggregate[]> {
  const config = getConfig();
  if (!config) return [];

  try {
    const documents = await fetchAllDocuments(config);
    const names = new Map<number, string>();

    documents
      .filter((document) => document.type === "pit")
      .forEach((document) => {
        const team = teamNumber(document);
        const name = teamName(document);
        if (team && name) names.set(team, name);
      });

    return documents
      .filter((document) => document.type === "aggregate_data")
      .map((document) => normalizeAggregate(document, names))
      .filter((team): team is TeamAggregate => team !== null)
      .sort((left, right) => (left.rank || Number.MAX_SAFE_INTEGER) - (right.rank || Number.MAX_SAFE_INTEGER) || left.team - right.team);
  } catch (error) {
    console.error("Unable to fetch team aggregates from Couchbase.", error);
    return [];
  }
}