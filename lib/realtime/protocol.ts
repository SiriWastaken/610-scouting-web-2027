// Shared by the Node realtime server, the browser client, and the tests, so it
// must stay free of framework imports and path aliases.

export interface RealtimeChange { type: "change"; seq: unknown; id: string; deleted: boolean; rev?: string; doc?: Record<string, unknown> }
interface CursorUpdate { type: "cursor"; seq: unknown }
export type RealtimeFrame = RealtimeChange | CursorUpdate;
export type ServerMessage = RealtimeFrame | { type: "ready" } | { type: "error"; retryable: boolean; resync: boolean };

const MAX_DOC_BYTES = 64 * 1024;

export function isCursor(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value === "string") return value.length > 0 && value.length <= 4096;
  if (value === null || typeof value !== "object") return false;
  try { return JSON.stringify(value).length <= 4096; } catch { return false; }
}

export function parseSubscription(value: unknown): { since: unknown } | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const parsed = JSON.parse(value) as { type?: unknown; since?: unknown };
    return parsed?.type === "subscribe" && isCursor(parsed.since) ? { since: parsed.since } : null;
  } catch { return null; }
}

export function isDashboardDocument(id: string): boolean {
  return /^(?:aggregate_\d+|scouting_\d+_\d+|pit_\d+|report_(?:card_)?\d+_[A-Za-z0-9 ._-]{1,128})$/.test(id);
}

/** Couchbase revision IDs look like `<generation>-<digest>`. */
export function isRev(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,9}-[A-Za-z0-9+/=_-]{1,128}$/.test(value);
}

/**
 * Orders two revisions of the same document the way Couchbase picks a winner:
 * higher generation first, then the lexically greater digest.
 */
export function compareRevs(left: string, right: string): number {
  const [leftGen, ...leftDigest] = left.split("-");
  const [rightGen, ...rightDigest] = right.split("-");
  const generation = Number(leftGen) - Number(rightGen);
  if (generation !== 0) return Math.sign(generation);
  const a = leftDigest.join("-"); const b = rightDigest.join("-");
  return a === b ? 0 : a > b ? 1 : -1;
}

const aggregateFields = new Set(["avgDefenseSkill", "breakSeverity", "bumpCrossed", "fuelPlowed", "fuelpassed", "fuelscored", "teleopFuelFed", "trenchCrossed", "L1accuracy", "L2accuracy", "L3accuracy", "aStopAvg", "autoFuelaccuracy", "autoL1accuracy", "autoPPG", "avgDriverSkill", "brokePercentage", "endgamePPG", "fuelfed", "matchesPlayed", "standing", "teleopPPG", "totalFuelPassed", "totalFuelPlowed", "L1AverageHangTime", "L2AverageHangTime", "L3AverageHangTime", "playedDefenseMatches", "teleopFuelaccuracy", "weightedBrokePercentage"]);
const pitFields = new Set(["teamName", "driveBase", "drivetrainType", "swerveOrientation", "driveMotors", "robotWeight", "robotHeight", "drivetrainDimensions", "openOrClosedTop", "typeOfShooter", "typeOfIndexer", "hopperCapacity", "funcIntake", "canDriveOverBump", "canGoUnderTrench", "scoringZones", "autonStartPosition", "climbCapability", "canPassFuel", "hasPassedBefore", "driverExperience", "driverYearsExperience", "defenseComfort", "defenseComfortDetailed", "humanPlayerConfidence", "hasRobotName", "robotName", "scoringZonesVerified", "hasVisionTracking", "scoringAids", "scoringAidsVerified"]);
const autoFields = new Set(["fuelScored", "fuelFed", "hangLevel", "markers", "paths", "fieldFlipped"]);
const teleopFields = new Set(["fuelscored", "fuelpassed", "fuelPlowed", "teleopFuelFed", "L1hang", "missedL1", "L2hang", "missedL2", "L3hang", "missedL3", "playedDefense", "breakDuration", "breakSeverity"]);
function pick(value: unknown, fields: Set<string>): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => fields.has(key)));
}
export function projectDashboardDocument(id: string, doc: Record<string, unknown>): Record<string, unknown> | null {
  const data = doc.data && typeof doc.data === "object" && !Array.isArray(doc.data) ? doc.data as Record<string, unknown> : doc;
  const out: Record<string, unknown> = { _id: id };
  if (isRev(doc._rev)) out._rev = doc._rev;
  if (typeof doc.timestamp === "string" && doc.timestamp.length <= 64) out.timestamp = doc.timestamp;
  if (typeof doc.team === "string" || typeof doc.team === "number") out.team = doc.team;
  if (typeof doc.teamNumber === "string" || typeof doc.teamNumber === "number") out.teamNumber = doc.teamNumber;
  if (id.startsWith("aggregate_")) {
    if (doc.type !== "aggregate_data") return null;
    out.type = doc.type; out.data = pick(data, aggregateFields);
  } else if (id.startsWith("scouting_")) {
    if (doc.type !== undefined && doc.type !== "scouting_data") return null;
    if (doc.type === "scouting_data") out.type = doc.type;
    out.data = { ...pick(data, new Set(["teamNumber"])), ...(data.start && typeof data.start === "object" ? { start: pick(data.start, new Set(["match", "alliance", "position", "practice"])) } : {}), ...(data.auto && typeof data.auto === "object" ? { auto: pick(data.auto, autoFields) } : {}), ...(data.teleop && typeof data.teleop === "object" ? { teleop: pick(data.teleop, teleopFields) } : {}) };
  } else if (id.startsWith("pit_")) {
    if (doc.type !== "pit") return null;
    out.type = doc.type; out.data = pick(data, pitFields);
  } else {
    if (doc.type !== "report_card") return null;
    out.type = doc.type; out.match = doc.match ?? data.matchNumber; out.team = doc.team ?? data.teamNumber;
    out.data = pick(data, new Set(["cardType", "ruleViolation", "matchNumber", "teamNumber", "timestamp"]));
  }
  return fitsFrameBudget(out) ? out : null;
}

/** Deeply nested input overflows the stack in JSON.stringify; a document we cannot measure is dropped. */
function fitsFrameBudget(doc: Record<string, unknown>): boolean {
  try { return JSON.stringify(doc).length <= MAX_DOC_BYTES; } catch { return false; }
}

/** Converts raw Sync Gateway `_changes` rows into frames that are safe to relay. */
export function parseChangesFrame(value: unknown): RealtimeFrame[] {
  let parsed: unknown;
  try { parsed = typeof value === "string" ? JSON.parse(value) : value; } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((row): RealtimeFrame[] => {
    if (!row || typeof row !== "object") return [];
    const change = row as Record<string, unknown>;
    if (!isCursor(change.seq)) return [];
    const cursor: CursorUpdate = { type: "cursor", seq: change.seq };
    if (typeof change.id !== "string" || !isDashboardDocument(change.id)) return [cursor];
    const doc = change.doc && typeof change.doc === "object" && !Array.isArray(change.doc) ? change.doc as Record<string, unknown> : undefined;
    const revisions = Array.isArray(change.changes) ? change.changes as Array<{ rev?: unknown }> : [];
    const rawRev = revisions[0]?.rev ?? doc?._rev;
    const rev = isRev(rawRev) ? rawRev : undefined;
    // `removed` means the document left this user's channels, which looks like a delete to us.
    if (change.deleted === true || doc?._deleted === true || change.removed !== undefined) {
      return [{ type: "change", seq: change.seq, id: change.id, deleted: true, ...(rev ? { rev } : {}) }];
    }
    const safe = doc && projectDashboardDocument(change.id, doc);
    if (!safe) return [cursor];
    return [{ type: "change", seq: change.seq, id: change.id, deleted: false, ...(rev ? { rev } : {}), doc: safe }];
  });
}

/** Validates a message received from the realtime server before the browser trusts it. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string" || raw.length > 2 * MAX_DOC_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "ready": return { type: "ready" };
    case "error": return { type: "error", retryable: message.retryable !== false, resync: message.resync === true };
    case "cursor": return isCursor(message.seq) ? { type: "cursor", seq: message.seq } : null;
    case "change": {
      if (typeof message.id !== "string" || !isDashboardDocument(message.id) || !isCursor(message.seq) || typeof message.deleted !== "boolean") return null;
      if (message.rev !== undefined && !isRev(message.rev)) return null;
      const doc = message.doc;
      if (message.deleted) return { type: "change", seq: message.seq, id: message.id, deleted: true, ...(message.rev ? { rev: message.rev as string } : {}) };
      if (!doc || typeof doc !== "object" || Array.isArray(doc) || (doc as Record<string, unknown>)._id !== message.id) return null;
      return { type: "change", seq: message.seq, id: message.id, deleted: false, ...(message.rev ? { rev: message.rev as string } : {}), doc: doc as Record<string, unknown> };
    }
    default: return null;
  }
}
