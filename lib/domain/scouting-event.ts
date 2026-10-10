// A ScoutingEvent is everything the team knows about one competition: the teams that were scouted, and
// the questions you can only ask of all of them together (who is ranked where, what the field looks like for
// a statistic, how complete our scouting is). It is the root of the domain model:
//
//   ScoutingEvent ── Team ── Match
//                         ├─ PitInterview
//                         └─ CardReport
//   Alliance ── Team (a what-if grouping of teams from the same event)
//
// The server sends plain rows (`TeamAggregate`) because only plain data crosses from server to browser;
// the browser builds this object graph from them (`ScoutingEvent.fromAggregates`).
import type { TeamAggregate } from "../../types/scouting.ts";
import { isOutlier } from "../data/team-stats.ts";
import { Alliance } from "./alliance.ts";
import type { AllianceColor } from "./match.ts";
import { Team, type StatName } from "./team.ts";

/** The scouted teams of one event, in the order given (the server sends them ranked). Immutable. */
export class ScoutingEvent {
  readonly teams: readonly Team[];
  private readonly byNumber: ReadonlyMap<number, Team>;

  constructor(teams: readonly Team[]) {
    this.teams = teams;
    this.byNumber = new Map(teams.map((team) => [team.number, team]));
  }

  static fromAggregates(rows: readonly TeamAggregate[]): ScoutingEvent {
    return new ScoutingEvent(rows.map((row) => Team.fromAggregate(row)));
  }

  get size(): number {
    return this.teams.length;
  }

  get isEmpty(): boolean {
    return this.teams.length === 0;
  }

  /** The team with this number, if it was scouted. */
  team(number: number): Team | undefined {
    return this.byNumber.get(number);
  }

  /** The team with this number, or the first team when it is unknown or unset (for pickers that must show something). */
  teamOrFirst(number: number | null | undefined): Team | null {
    return (number == null ? undefined : this.byNumber.get(number)) ?? this.teams[0] ?? null;
  }

  /** The same event with one team replaced (for example by `team.withDetail(...)`). */
  withTeam(team: Team): ScoutingEvent {
    return new ScoutingEvent(this.teams.map((existing) => (existing.number === team.number ? team : existing)));
  }

  /** Every team's value for `stat`, teams without data skipped. This is the field an outlier is judged against. */
  fieldValues(stat: StatName): number[] {
    return this.teams.map((team) => team.statValue(stat)).filter((value): value is number => value !== null);
  }

  /** Whether `team`'s value for `stat` stands out from the rest of the field. A team with no data never does. */
  isOutlier(team: Team, stat: StatName): boolean {
    const value = team.statValue(stat);
    return value !== null && isOutlier(value, this.fieldValues(stat));
  }

  /** Builds an alliance from team numbers; numbers that were not scouted are skipped. */
  alliance(color: AllianceColor, numbers: readonly number[]): Alliance {
    const robots = numbers.flatMap((number) => this.byNumber.get(number) ?? []);
    return new Alliance(color, robots);
  }

  /** Matches scouted across all teams. */
  get observedMatches(): number {
    return this.teams.reduce((total, team) => total + team.matchesPlayed, 0);
  }

  /** Teams whose aggregate has matches, a rank and a fuel accuracy. */
  get completeTeams(): Team[] {
    return this.teams.filter((team) => team.hasCompleteRecord());
  }

  /** Percentage of teams with a complete record; 0 for an empty event. */
  get coveragePercent(): number {
    return this.isEmpty ? 0 : Math.round((this.completeTeams.length / this.size) * 100);
  }
}
