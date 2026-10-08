// A Team is one robot team at the event: its averages (the aggregate row) and, once loaded, its scouted
// matches, pit interview and card reports. The ScoutingEvent owns the Teams; screens ask a Team questions
// instead of digging through raw fields.
import { appConfig } from "../../app.config.ts";
import type { TeamAggregate } from "../../types/scouting.ts";
import type { CardReport } from "../data/team-documents.ts";
import { compareValues, type Leader } from "../data/team-stats.ts";
import type { Match } from "./match.ts";
import type { PitInterview } from "./pit-interview.ts";

/** Statistics on a team that can be missing, mapped to the raw fields they are read from (first present wins). */
const RAW_FIELDS = {
  autoPpg: ["autoPPG"],
  teleopPpg: ["teleopPPG"],
  endgamePpg: ["endgamePPG"],
  fuelAccuracy: ["teleopFuelaccuracy", "autoFuelaccuracy"],
  driverSkill: ["avgDriverSkill"],
  defenseRating: ["avgDefenseSkill"],
} as const;

/** A statistic a Team can report, or "total" for auto + teleop + endgame points. */
export type StatKey = keyof typeof RAW_FIELDS;
export type StatName = StatKey | "total";

/** What is known about a team beyond its averages. Loaded on demand, one team at a time. */
export interface TeamDetail {
  matches?: readonly Match[];
  pit?: PitInterview | null;
  cards?: readonly CardReport[];
}

function isScouted(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim() !== "" && Number.isFinite(Number(value));
  return false;
}

/**
 * One team. Immutable: loading more detail returns a new Team (`withDetail`), so React sees the change.
 *
 * The central rule: the aggregate stores unscouted values as 0, which is indistinguishable from a real
 * zero. `statValue` is the way to read a statistic; it returns `null` for "never scouted".
 */
export class Team {
  readonly aggregate: TeamAggregate;
  readonly matches: readonly Match[];
  readonly pit: PitInterview | null;
  readonly cards: readonly CardReport[];

  constructor(aggregate: TeamAggregate, detail: TeamDetail = {}) {
    this.aggregate = aggregate;
    this.matches = detail.matches ?? [];
    this.pit = detail.pit ?? null;
    this.cards = detail.cards ?? [];
  }

  static fromAggregate(aggregate: TeamAggregate): Team {
    return new Team(aggregate);
  }

  get number(): number {
    return this.aggregate.team;
  }

  get name(): string {
    return this.aggregate.name;
  }

  /** Event rank, or 0 when the team is not ranked yet. */
  get rank(): number {
    return this.aggregate.rank;
  }

  /** How many matches have been scouted for this team. */
  get matchesPlayed(): number {
    return this.aggregate.matches;
  }

  /** The Blue Alliance nickname when there is one, otherwise the scouted name. */
  displayName(nickname?: string): string {
    return nickname || this.name;
  }

  /** The same team with its loaded detail replaced (omitted parts are kept). */
  withDetail(detail: TeamDetail): Team {
    return new Team(this.aggregate, {
      matches: detail.matches ?? this.matches,
      pit: detail.pit === undefined ? this.pit : detail.pit,
      cards: detail.cards ?? this.cards,
    });
  }

  /**
   * The statistic's value, or `null` when it was never scouted: no matches, or the field is absent, null or
   * not a number. "total" is auto + teleop + endgame, and needs all three.
   */
  statValue(key: StatName): number | null {
    return key === "total" ? this.totalPoints() : this.scoutedValue(key);
  }

  private scoutedValue(key: StatKey): number | null {
    if (this.matchesPlayed <= 0) return null;
    const raw = RAW_FIELDS[key].find((field) => isScouted(this.aggregate.rawData[field]));
    return raw === undefined ? null : this.aggregate[key];
  }

  /** Auto + teleop + endgame points per game, or `null` unless all three phases have data. */
  totalPoints(): number | null {
    const phases = [this.scoutedValue("autoPpg"), this.scoutedValue("teleopPpg"), this.scoutedValue("endgamePpg")];
    return phases.every((value): value is number => value !== null) ? phases.reduce((sum, value) => sum + value, 0) : null;
  }

  /** Fewer scouted matches than the configured threshold, so averages are easily skewed. */
  isLowSample(): boolean {
    return this.matchesPlayed < appConfig.analysis.lowSampleThreshold;
  }

  /** Whether the aggregate has everything the Coverage page wants: matches, a rank and a fuel accuracy. */
  hasCompleteRecord(): boolean {
    return this.matchesPlayed > 0 && this.rank > 0 && this.aggregate.fuelAccuracy > 0;
  }

  /** Who is ahead on `key`: "a" is this team, "b" the other. `null` when either has no data. */
  compareTo(other: Team, key: StatName): { leader: Leader; margin: number } {
    return compareValues(this.statValue(key), other.statValue(key));
  }

  /** Climb levels reached across the loaded matches, e.g. for a quick "can this team climb?" answer. */
  bestClimb(): Match["climbLevel"] {
    const order = ["-", "L1", "L2", "L3"] as const;
    return this.matches.reduce<Match["climbLevel"]>((best, match) => (order.indexOf(match.climbLevel) > order.indexOf(best) ? match.climbLevel : best), "-");
  }
}
