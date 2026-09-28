import type { TeamAggregate } from "@/types/scouting";
import { isRev } from "./realtime-protocol.ts";
import { storedIsNewer, type DocumentStore } from "./realtime-store.ts";

export interface AggregateDocument {
  _id?: string;
  timestamp?: string;
  team?: number | string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

function asNumber(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function asPercentage(value: unknown, fallback = 0): number {
  return Math.round(asNumber(value, fallback));
}

export function getDocumentTeam(document: AggregateDocument): number {
  return asNumber(document.team ?? document.data?.team ?? document.data?.teamNumber);
}

export function getDocumentTeamName(document: AggregateDocument): string | undefined {
  const data = document.data ?? document;
  const value = data.teamName ?? data.team_name ?? data.name;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeAggregateDocument(document: AggregateDocument, names: Map<number, string> = new Map()): TeamAggregate | null {
  const data = document.data;
  if (!data) return null;
  const team = getDocumentTeam({ ...document, data });
  if (!team) return null;
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

/** Applies realtime aggregate and pit (team name) documents on top of a server snapshot. */
export function mergeAggregates(snapshot: TeamAggregate[], store: DocumentStore): TeamAggregate[] {
  const byId = new Map(snapshot.map((team) => [team.sourceId ?? `aggregate_${team.team}`, team]));
  const names = new Map<number, string>();
  let changed = false;
  for (const stored of store.values()) {
    const pitTeam = stored.id.match(/^pit_(\d+)$/)?.[1];
    if (pitTeam) {
      const name = stored.doc && getDocumentTeamName(stored.doc);
      if (name) names.set(Number(pitTeam), name);
      continue;
    }
    if (!stored.id.startsWith("aggregate_")) continue;
    const existing = byId.get(stored.id);
    if (existing && !storedIsNewer(stored, existing.rev)) continue;
    if (existing && existing.rev === stored.rev && !stored.deleted) continue;
    const normalized = stored.doc ? normalizeAggregateDocument({ ...stored.doc, _id: stored.id }) : null;
    if (stored.deleted || !normalized) {
      if (stored.deleted && byId.delete(stored.id)) changed = true;
      continue;
    }
    normalized.name = existing?.name ?? normalized.name;
    byId.set(stored.id, normalized);
    changed = true;
  }
  if (!changed && names.size === 0) return snapshot;
  return [...byId.values()]
    .map((team) => names.has(team.team) && names.get(team.team) !== team.name ? { ...team, name: names.get(team.team) as string } : team)
    .sort(byRankThenTeam);
}
