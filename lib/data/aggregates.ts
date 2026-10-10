// Turns aggregate documents (computed upstream, one per team) into TeamAggregate rows, and merges live changes
// onto a server snapshot. Statistic names are mapped here.
import type { TeamAggregate } from "@/types/scouting";
import { isRev } from "../realtime/protocol.ts";
import { storedIsNewer, type DocumentStore, type StoredDocument } from "../realtime/documents.ts";

/** An aggregate document before normalisation. */
export interface AggregateDocument {
  _id?: string;
  timestamp?: string;
  team?: number | string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

function asNumber(value: unknown, fallback = 0): number {
  // Only numbers and numeric strings count. Coercing anything else is unsafe:
  // a JSON object such as {"toString": []} makes Number() throw.
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function asPercentage(value: unknown, fallback = 0): number {
  return Math.round(asNumber(value, fallback));
}

/** The team number of a document, from its body or its id. */
export function getDocumentTeam(document: AggregateDocument): number {
  return asNumber(document.team ?? document.data?.team ?? document.data?.teamNumber);
}

/** The team name in a document, if it has one. */
export function getDocumentTeamName(document: AggregateDocument): string | undefined {
  const data = document.data ?? document;
  const value = data.teamName ?? data.team_name ?? data.name;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Turns an aggregate document into a TeamAggregate row, or null if it has no statistics, a 
 * non-positive team, or a body that disagrees with its id.
 */
export function normalizeAggregateDocument(document: AggregateDocument, names: Map<number, string> = new Map()): TeamAggregate | null {
  const data = document.data;
  // No statistics (including a body the privacy projection emptied) is not a team row.
  if (!data || Object.keys(data).length === 0) return null;
  // Aggregates are keyed `aggregate_<team>`; the id supplies the team when the body does not.
  const idTeam = typeof document._id === "string" ? document._id.match(/^aggregate_(\d+)$/)?.[1] : undefined;
  const team = getDocumentTeam({ ...document, data }) || Number(idTeam ?? 0);
  // FRC team numbers are positive integers; anything else would render a phantom team row.
  if (!Number.isSafeInteger(team) || team <= 0) return null;
  // A body that names a different team than its id is corrupt; trusting it would show two rows for one team.
  if (idTeam !== undefined && Number(idTeam) !== team) return null;
  return {
    team,
    name: names.get(team) ?? `Team ${team}`,
    recordedAt: document.timestamp,
    sourceId: document._id,
    rev: isRev(document._rev) ? document._rev : undefined,
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

const byRankThenTeam = (left: TeamAggregate, right: TeamAggregate) =>
  (left.rank || Number.MAX_SAFE_INTEGER) - (right.rank || Number.MAX_SAFE_INTEGER) || left.team - right.team;

/**
 * Applies realtime aggregate and pit (team name) documents on top of a server
 * snapshot. `snapshotNames` are the pit names the server knew when it built the
 * snapshot (see `fetchTeamAggregatesSnapshot`), so a team whose aggregate
 * arrives later is named the same way a freshly loaded page would name it.
 */
export function mergeAggregates(snapshot: TeamAggregate[], store: DocumentStore, snapshotNames: Readonly<Record<string, string>> = {}): TeamAggregate[] {
  const byId = new Map(snapshot.map((team) => [team.sourceId ?? `aggregate_${team.team}`, team]));
  // Pit changes seen on the feed; `undefined` means the name was removed.
  const names = new Map<number, string | undefined>();
  let changed = false;
  for (const stored of store.values()) {
    const pitTeam = stored.id.match(/^pit_(\d+)$/)?.[1];
    if (pitTeam) names.set(Number(pitTeam), stored.deleted || !stored.doc ? undefined : getDocumentTeamName(stored.doc));
    else if (stored.id.startsWith("aggregate_") && applyAggregate(byId, stored, snapshotNames)) changed = true;
  }
  if (!changed && names.size === 0) return snapshot;
  return [...byId.values()]
    .map((team) => {
      if (!names.has(team.team)) return team;
      const name = names.get(team.team) ?? `Team ${team.team}`;
      return name === team.name ? team : { ...team, name };
    })
    .sort(byRankThenTeam);
}

/** Applies one stored aggregate change to `byId`; returns whether anything changed. */
function applyAggregate(byId: Map<string, TeamAggregate>, stored: StoredDocument, snapshotNames: Readonly<Record<string, string>>): boolean {
  const existing = byId.get(stored.id);
  if (existing && !storedIsNewer(stored, existing.rev)) return false;
  if (existing && existing.rev === stored.rev && !stored.deleted) return false;
  const normalized = stored.doc ? normalizeAggregateDocument({ ...stored.doc, _id: stored.id }) : null;
  if (stored.deleted || !normalized) return Boolean(stored.deleted) && byId.delete(stored.id);
  normalized.name = existing?.name ?? (Object.hasOwn(snapshotNames, normalized.team) ? snapshotNames[normalized.team] : normalized.name);
  byId.set(stored.id, normalized);
  return true;
}
