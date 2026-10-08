// A PitInterview is what a scout learned by walking up to a team's pit and asking. It wraps the raw
// document (`PitData`) and owns the few judgements about it that more than one screen needs.
import type { PitData } from "../data/team-documents.ts";

/** One team's pit interview. Immutable. The answers themselves are in `data`. */
export class PitInterview {
  readonly data: PitData;

  constructor(data: PitData) {
    this.data = data;
  }

  /**
   * Builds the interview from a pit document. Pit documents keep the answers under `data`, but older ones
   * put them at the top level; both are accepted.
   */
  static fromDocument(document: Record<string, unknown>): PitInterview {
    return new PitInterview((document.data ?? document) as PitData);
  }

  /** Who asked the questions, if recorded. */
  get scoutName(): string | undefined {
    return this.data.scoutName;
  }

  /**
   * The robot photo as something an `<img>` can show, or `null` when there is none. Photos arrive either as
   * a ready URL or as base64 content inside a blob object (with or without a `data:` prefix).
   */
  photoUri(): string | null {
    const photo = this.data.robotPhoto;
    if (!photo) return null;
    if (typeof photo === "string") return photo;
    const base64 = photo.content ?? photo.data;
    if (!base64) return null;
    const mime = photo.contentType ?? photo.content_type ?? "image/jpeg";
    return `data:${mime};base64,${base64.replace(/^data:[^;]+;base64,/, "")}`;
  }

  /** Whether the team answered the older strategy questions that the current form no longer asks. */
  hasLegacyAnswers(): boolean {
    const { qualStrategy, playoffStrategy, robotUnique, teamUnique, idealAlliance } = this.data;
    return Boolean(qualStrategy || playoffStrategy || robotUnique || teamUnique || idealAlliance);
  }

  /** Whether the team said it has named its robot. */
  namesItsRobot(): boolean {
    return this.data.hasRobotName?.toLowerCase() === "yes";
  }
}
