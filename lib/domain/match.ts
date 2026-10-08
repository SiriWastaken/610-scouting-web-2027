// A Match is one scouted appearance of one team in one match: where it started, what it did in
// autonomous, what it did in teleop. It wraps the sanitized document (lib/data/match-data.ts) and adds
// the questions the UI keeps asking of it, so no component re-derives "which climb level?" itself.
import type { SanitizedMatch } from "../data/match-data.ts";

export type AllianceColor = "red" | "blue";
export type ClimbLevel = "L1" | "L2" | "L3" | "-";

/**
 * One scouted match. Immutable. It has the same fields as the sanitized document it wraps
 * (`start`, `auto`, `teleop`, `_id`, `teamNumber`), so code that only reads data can take either.
 */
export class Match implements SanitizedMatch {
  readonly _id?: string;
  readonly teamNumber?: number | string;
  readonly start: SanitizedMatch["start"];
  readonly auto: SanitizedMatch["auto"];
  readonly teleop: SanitizedMatch["teleop"];

  constructor(data: SanitizedMatch) {
    this._id = data._id;
    this.teamNumber = data.teamNumber;
    this.start = data.start ?? {};
    this.auto = data.auto ?? {};
    this.teleop = data.teleop ?? {};
  }

  /** The match number, or `undefined` when neither the document body nor its id said. */
  get number(): number | undefined {
    return this.start.match;
  }

  /** Practice matches are listed but flagged. */
  get isPractice(): boolean {
    return Boolean(this.start.practice);
  }

  /** The alliance the scout recorded; anything unrecognised is treated as red, as the match log always has. */
  get allianceColor(): AllianceColor {
    return this.start.alliance?.toLowerCase() === "blue" ? "blue" : "red";
  }

  /** Whether the scout recorded an alliance at all (the match details say "unknown" otherwise). */
  get hasAlliance(): boolean {
    const side = this.start.alliance?.toLowerCase();
    return side === "red" || side === "blue";
  }

  /** The highest rung the robot hung from, or "-" when it did not hang. */
  get climbLevel(): ClimbLevel {
    const { L1hang, L2hang, L3hang } = this.teleop;
    return L3hang ? "L3" : L2hang ? "L2" : L1hang ? "L1" : "-";
  }

  /** Whether the robot tried to climb at all, successfully or not. */
  get attemptedClimb(): boolean {
    const { L1hang, missedL1, L2hang, missedL2, L3hang, missedL3 } = this.teleop;
    return [L1hang, missedL1, L2hang, missedL2, L3hang, missedL3].some((count) => (count ?? 0) > 0);
  }

  /** Fuel scored in teleop (0 when not recorded). */
  get teleopFuelScored(): number {
    return this.teleop.fuelscored ?? 0;
  }

  /** The scout's free-text notes, or `undefined` when there are none. */
  get notes(): string | undefined {
    return this.teleop.general || undefined;
  }

  /** Whether the auto path viewer has anything to draw. */
  get hasAutoPath(): boolean {
    return (this.auto.paths?.length ?? 0) > 0;
  }
}
