// Scouting documents come from many devices and app versions. Before the Teams
// page renders one, keep only values of the expected type, so a single bad
// submission cannot crash the page for everyone.

type Doc = Record<string, unknown>;

const record = (value: unknown): Doc | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Doc : undefined;
const text = (value: unknown) => typeof value === "string" ? value : undefined;
const bool = (value: unknown) => typeof value === "boolean" ? value : undefined;
function count(value: unknown): number | undefined {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}
function defined<T extends Doc>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * A scouted match with every value checked to be of the expected type. The Match class 
 * (lib/domain/match.ts) wraps it.
 */
export interface SanitizedMatch {
  _id?: string;
  teamNumber?: number | string;
  start: { match?: number; alliance?: string; position?: string; scoutName?: string; practice?: boolean };
  auto: { fuelScored?: number; fuelFed?: number; hangLevel?: number; markers?: { x: number; y: number; type: "pickup" | "scoring" }[]; paths?: string[]; fieldFlipped?: boolean };
  teleop: {
    fuelscored?: number; fuelpassed?: number; fuelPlowed?: number; teleopFuelFed?: number;
    L1hang?: number; missedL1?: number; L2hang?: number; missedL2?: number; L3hang?: number; missedL3?: number;
    playedDefense?: number; breakDuration?: number; breakSeverity?: number | string; general?: string;
  };
}

/** `matchFromId` fills the match number from a `scouting_<team>_<match>` id when the body lacks one. */
export function sanitizeMatchData(data: unknown, id?: string, matchFromId?: number): SanitizedMatch {
  const body = record(data) ?? {};
  const start = record(body.start) ?? {};
  const auto = record(body.auto) ?? {};
  const teleop = record(body.teleop) ?? {};
  const teamNumber = typeof body.teamNumber === "string" || count(body.teamNumber) !== undefined ? body.teamNumber as number | string : undefined;
  const numbers = (source: Doc, keys: string[]) => Object.fromEntries(keys.map((key) => [key, count(source[key])]));
  return defined({
    _id: id,
    teamNumber,
    start: defined({ match: count(start.match) ?? matchFromId, alliance: text(start.alliance), position: text(start.position), scoutName: text(start.scoutName), practice: bool(start.practice) }),
    auto: defined({
      ...numbers(auto, ["fuelScored", "fuelFed", "hangLevel"]),
      markers: Array.isArray(auto.markers)
        ? auto.markers.flatMap((marker) => {
          const value = record(marker);
          const x = count(value?.x); const y = count(value?.y);
          return value && x !== undefined && y !== undefined && (value.type === "pickup" || value.type === "scoring") ? [{ x, y, type: value.type }] : [];
        })
        : undefined,
      paths: Array.isArray(auto.paths) ? auto.paths.filter((path): path is string => typeof path === "string") : undefined,
      fieldFlipped: bool(auto.fieldFlipped),
    }),
    teleop: defined({
      ...numbers(teleop, ["fuelscored", "fuelpassed", "fuelPlowed", "teleopFuelFed", "L1hang", "missedL1", "L2hang", "missedL2", "L3hang", "missedL3", "playedDefense", "breakDuration"]),
      breakSeverity: text(teleop.breakSeverity) ?? count(teleop.breakSeverity),
      general: text(teleop.general),
    }),
  }) as SanitizedMatch;
}
