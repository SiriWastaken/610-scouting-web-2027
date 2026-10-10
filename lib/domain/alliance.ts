// An Alliance is the robots a strategist is considering putting on one side of a match. Its score is the
// plain sum of their points per game: a scouting baseline, not a simulation.
import { compareValues, isOutlier, type Leader } from "../data/team-stats.ts";
import type { AllianceColor } from "./match.ts";
import type { Team } from "./team.ts";

/** Up to `appConfig.analysis.robotsPerAlliance` teams on one side. Immutable. */
export class Alliance {
  readonly color: AllianceColor;
  readonly robots: readonly Team[];

  constructor(color: AllianceColor, robots: readonly Team[]) {
    this.color = color;
    this.robots = robots;
  }

  get isEmpty(): boolean {
    return this.robots.length === 0;
  }

  /** Points per game, summed over the robots; a robot with no data adds 0. */
  get score(): number {
    return this.robots.reduce((sum, team) => sum + (team.totalPoints() ?? 0), 0);
  }

  /** The score, or `null` when no robot is selected (an empty alliance has no score, not a score of 0). */
  get scoreOrNull(): number | null {
    return this.isEmpty ? null : this.score;
  }

  /** Scouted-match counts, in robot order. */
  get sampleSizes(): number[] {
    return this.robots.map((team) => team.matchesPlayed);
  }

  /** Who leads between this alliance and `other` ("a" is this one). `null` leader when either is empty. */
  compareTo(other: Alliance): { leader: Leader; margin: number } {
    return compareValues(this.scoreOrNull, other.scoreOrNull);
  }

  /**
   * Why the score deserves caution: robots with no data, a low sample, or an outlier total.
   * `totals` is every team's total at the event (`ScoutingEvent.fieldValues("total")`).
   */
  confidenceReasons(totals: readonly number[]): string[] {
    return this.robots.flatMap((team) => {
      const total = team.totalPoints();
      if (total === null) return [`${team.number}: no data`];
      const reasons: string[] = [];
      if (team.isLowSample()) reasons.push(`${team.number}: ${team.matchesPlayed === 1 ? "1 match" : `${team.matchesPlayed} matches`}`);
      if (isOutlier(total, totals)) reasons.push(`${team.number}: outlier`);
      return reasons;
    });
  }
}
