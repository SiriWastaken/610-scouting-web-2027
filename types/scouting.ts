export interface TeamAggregate {
  team: number;
  name: string;
  recordedAt?: string;
  sourceId?: string;
  /** Couchbase revision of the source document, used to order realtime updates. */
  rev?: string;
  rawData: Record<string, unknown>;
  rank: number;
  matches: number;
  autoPpg: number;
  teleopPpg: number;
  endgamePpg: number;
  fuelPerMatch: number;
  fuelAccuracy: number;
  defenseRating: number;
  driverSkill: number;
  breakRate: number;
}

export type TeamSortKey = keyof Pick<
  TeamAggregate,
  "team" | "rank" | "matches" | "autoPpg" | "teleopPpg" | "endgamePpg" | "fuelPerMatch" | "fuelAccuracy"
>;