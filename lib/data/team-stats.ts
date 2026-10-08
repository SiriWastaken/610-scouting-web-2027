// Pure helpers for reading and comparing team averages: whether a value was
// really scouted, whether a sample is trustworthy, and how numbers are printed.
// Used by the Strategy page; no React, no I/O, so it is unit-tested directly.
import type { TeamAggregate } from "../../types/scouting.ts";

/** Shown wherever a value was never scouted. Distinct from a real 0. */
export const NO_DATA = "—";

/** Rating scales, as the scouting form records them (also printed on the team page). */
export const DRIVER_SKILL_SCALE = 10;
export const DEFENSE_RATING_SCALE = 5;

/** A team with fewer scouted matches than this is flagged "low sample". */
export const LOW_SAMPLE_THRESHOLD = 3;

/**
 * Outlier rule (see `isOutlier`): a value is a likely outlier when, compared with
 * the other teams that have data for the same statistic, it is either more than
 * `OUTLIER_SD` standard deviations from the mean, or more than
 * `OUTLIER_MEDIAN_MULTIPLE` times the median.
 */
export const OUTLIER_SD = 2.5;
export const OUTLIER_MEDIAN_MULTIPLE = 3;
/** Fewer teams than this and neither rule says anything useful, so nothing is flagged. */
const OUTLIER_MIN_FIELD = 5;

/** Statistics on `TeamAggregate` that can be missing, mapped to the raw fields they are read from (first present wins). */
const RAW_FIELDS = {
  autoPpg: ["autoPPG"],
  teleopPpg: ["teleopPPG"],
  endgamePpg: ["endgamePPG"],
  fuelAccuracy: ["teleopFuelaccuracy", "autoFuelaccuracy"],
  driverSkill: ["avgDriverSkill"],
  defenseRating: ["avgDefenseSkill"],
} as const;

export type StatKey = keyof typeof RAW_FIELDS;

function isScouted(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim() !== "" && Number.isFinite(Number(value));
  return false;
}

/**
 * The statistic's value, or `null` when it was never scouted: no matches, or the
 * field is absent, null or not a number. `TeamAggregate` stores those as 0, which
 * would otherwise be indistinguishable from a real zero.
 */
export function statValue(team: TeamAggregate, key: StatKey): number | null {
  if (team.matches <= 0) return null;
  const raw = RAW_FIELDS[key].find((field) => isScouted(team.rawData[field]));
  return raw === undefined ? null : team[key];
}

/** Auto + teleop + endgame points per game, or `null` unless all three phases have data. */
export function totalPoints(team: TeamAggregate): number | null {
  const phases = [statValue(team, "autoPpg"), statValue(team, "teleopPpg"), statValue(team, "endgamePpg")];
  return phases.every((value): value is number => value !== null) ? phases.reduce((sum, value) => sum + value, 0) : null;
}

export function isLowSample(matches: number): boolean {
  return matches < LOW_SAMPLE_THRESHOLD;
}

/** Median of the values (0 for none). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Whether `value` is a likely outlier among `field` (every team's value for the
 * same statistic, missing values already removed, `value` included).
 *
 *  - more than `OUTLIER_SD` population standard deviations above or below the mean, or
 *  - above `OUTLIER_MEDIAN_MULTIPLE` times the median (only when the median is positive).
 *
 * Needs at least `OUTLIER_MIN_FIELD` teams. With n values the largest possible
 * z-score is (n - 1) / sqrt(n), so the SD rule cannot fire on very small fields;
 * the median rule covers the gap.
 */
export function isOutlier(value: number, field: readonly number[]): boolean {
  if (field.length < OUTLIER_MIN_FIELD) return false;
  const mean = field.reduce((sum, item) => sum + item, 0) / field.length;
  const deviation = Math.sqrt(field.reduce((sum, item) => sum + (item - mean) ** 2, 0) / field.length);
  if (deviation > 0 && Math.abs(value - mean) / deviation > OUTLIER_SD) return true;
  const middle = median(field);
  return middle > 0 && value > OUTLIER_MEDIAN_MULTIPLE * middle;
}

/** Every team's value for `key` (or the total), missing values skipped. The field `isOutlier` compares against. */
export function fieldValues(teams: readonly TeamAggregate[], key: StatKey | "total"): number[] {
  return teams.map((team) => (key === "total" ? totalPoints(team) : statValue(team, key))).filter((value): value is number => value !== null);
}

export type Leader = "a" | "b" | "tie" | null;

/** Who is ahead (higher wins). `null` when either side has no data, so nobody "wins" against a blank. */
export function compareValues(a: number | null, b: number | null): { leader: Leader; margin: number } {
  if (a === null || b === null) return { leader: null, margin: 0 };
  // Compare what is displayed: values that print the same are a tie, not a 0.0 lead.
  const margin = Math.round(Math.abs(a - b) * 10) / 10;
  if (margin === 0) return { leader: "tie", margin: 0 };
  return { leader: a > b ? "a" : "b", margin };
}

// Formatting: points and ratings to 1 decimal, accuracy as an integer percent.

export function formatPoints(value: number | null): string {
  return value === null ? NO_DATA : value.toFixed(1);
}

export function formatPercent(value: number | null): string {
  return value === null ? NO_DATA : `${Math.round(value)}%`;
}

export function formatRating(value: number | null, scale: number): string {
  return value === null ? NO_DATA : `${value.toFixed(1)} / ${scale}`;
}

/** "+47.5" for a lead of 47.5. */
export function formatMargin(margin: number): string {
  return `+${margin.toFixed(1)}`;
}

/** "6 matches", "1 match", "No matches". */
export function formatMatches(matches: number): string {
  return matches <= 0 ? "No matches" : `${matches} ${matches === 1 ? "match" : "matches"}`;
}

/** "+8%" for an accuracy lead of 8 points. */
export function formatPercentMargin(margin: number): string {
  return `+${Math.round(margin)}%`;
}
