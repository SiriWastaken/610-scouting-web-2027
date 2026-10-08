// Client-side helpers for the Teams page: fetch a team's scouting documents and
// turn loosely-typed documents into the shapes the views render.

import { sanitizeMatchData, type SanitizedMatch } from "@/lib/data/match-data";

/** A sanitized `scouting_<team>_<match>` document, as the match views render it. */
export type MatchData = SanitizedMatch;

/**
 * Shape of the documents returned by `/api/dashboard-documents` (and the realtime feed).
 * Wraps loosely-typed document data without resorting to `any`.
 */
export type RawDoc = {
  _default?: Record<string, unknown>;
  team?: string | number;
  teamNumber?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export function unwrapDoc(r: RawDoc): Record<string, unknown> {
  return (r._default ?? r) as Record<string, unknown>;
}

export async function queryDashboardDocuments(kind: 'matches' | 'pit' | 'reports', team: number): Promise<RawDoc[]> {
  const response = await fetch(`/api/dashboard-documents?kind=${kind}&team=${team}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${kind} data (${response.status})`);
  const payload = await response.json() as { documents?: RawDoc[] };
  return payload.documents ?? [];
}

/**
 * Scouting docs are keyed like `scouting_<teamNumber>_<matchNumber>`,
 * `pit_<teamNumber>`, and `aggregate_<teamNumber>` rather than by an explicit
 * team field, so team (and match) numbers are pulled from `_id` as a
 * fallback whenever the doc/data body doesn't have them directly.
 */
function parseScoutingId(id: unknown): { team?: string; match?: string } {
  if (typeof id !== 'string') return {};
  const match = id.match(/^(?:scouting|pit|aggregate|report(?:_card)?)_(\d+)(?:_(.+))?/);
  if (!match) return {};
  return { team: match[1], match: match[2] };
}

export function docTeam(doc: Record<string, unknown>): string | undefined {
  const data = doc.data as Record<string, unknown> | undefined;
  const explicit = doc.team ?? doc.teamNumber ?? data?.team ?? data?.teamNumber;
  if (explicit !== undefined && explicit !== null) return String(explicit);
  return parseScoutingId(doc._id).team;
}

/** Stable empty input for realtime merges while REST data is loading. */
export const NO_DOCS: Record<string, unknown>[] = [];

export function toMatchData(doc: Record<string, unknown>): MatchData {
  // Fill in the match number from the doc id (`scouting_<team>_<match>`) if it
  // isn't already in the data, and drop values of the wrong type so one bad
  // submission cannot crash the page. Builds a copy: documents may be shared
  // with the realtime store.
  const { match: matchNum } = parseScoutingId(doc._id);
  return sanitizeMatchData(doc.data ?? doc, typeof doc._id === 'string' ? doc._id : undefined, matchNum && Number.isFinite(Number(matchNum)) ? Number(matchNum) : undefined);
}

/** Only strings and finite numbers are rendered; anything else from a malformed document falls back. */
function label(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  }
  return undefined;
}

export function toCardReport(doc: Record<string, unknown>): CardReport {
  const data = (doc.data && typeof doc.data === 'object' ? doc.data : {}) as Record<string, unknown>;
  return {
    sourceId: String(doc._id ?? ''),
    match: label(doc.match, data.matchNumber) ?? 'N/A',
    team: label(doc.team, data.teamNumber) ?? 'N/A',
    cardType: label(data.cardType) ?? 'Unknown',
    ruleViolation: label(data.ruleViolation) ?? 'N/A',
    notes: label(data.notes) ?? 'None',
    timestamp: label(doc.timestamp, data.timestamp),
  };
}

/**
 * Scouting-match docs are keyed `scouting_<teamNumber>_<matchNumber>`
 * (not distinguished by a `type` field), so we fetch by `_id` prefix instead.
 */
export const MATCH_DOC_ID_PREFIX = 'scouting_';

interface CouchbaseBlob {
  content?: string;
  contentType?: string;
  data?: string;
  content_type?: string;
}

export interface PitData {
  driveBase?: string;
  drivetrainType?: string;
  swerveOrientation?: string;
  driveMotors?: string;
  robotWeight?: string;
  robotHeight?: string;
  drivetrainDimensions?: string;
  openOrClosedTop?: string;
  typeOfShooter?: string;
  typeOfIndexer?: string;
  hopperCapacity?: string | number;
  funcIntake?: string;
  canDriveOverBump?: string;
  canGoUnderTrench?: string;
  scoringZones?: string;
  autonStartPosition?: string;
  climbCapability?: string;
  canPassFuel?: string;
  hasPassedBefore?: string;
  driverExperience?: string;
  driverYearsExperience?: number;
  defenseComfort?: number;
  defenseComfortDetailed?: number;
  humanPlayerConfidence?: number;
  hasRobotName?: string;
  robotName?: string;
  robotNameOrigin?: string;
  favoriteRobotPart?: string;
  teamFunFact?: string;
  teamGoals?: string;
  scoringZonesVerified?: string;
  hasVisionTracking?: string;
  scoringAids?: string;
  scoringAidsVerified?: string;
  robotJankOrTippy?: string;
  redFlags?: string;
  extraComments?: string;
  qualStrategy?: string;
  playoffStrategy?: string;
  robotUnique?: string;
  teamUnique?: string;
  idealAlliance?: string;
  robotPhoto?: string | CouchbaseBlob | null;
  scoutName?: string;
}

export interface CardReport {
  sourceId?: string;
  match: string | number;
  team: string | number;
  cardType: string;
  ruleViolation: string;
  notes: string;
  timestamp?: string;
}
