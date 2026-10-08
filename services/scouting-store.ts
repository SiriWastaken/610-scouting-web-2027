// The scouting data the dashboard reads, behind one interface. Pages and API routes import `scoutingStore`
// from here; which backend answers is `appConfig.storage.scouting`. To add a backend: implement
// `ScoutingStore`, register it below, and the compiler then requires nothing else in the app to change.
// Not covered by this seam (still Sync Gateway-specific): the realtime feed (lib/realtime) and the
// Admin → Sync panels (services/health.ts).
import "server-only";
import { appConfig, type ScoutingBackend } from "@/app.config";
import type { TeamAggregate } from "@/types/scouting";
import * as syncGateway from "@/services/couchbase";

/** What the pages need from a scouting-data backend. */
export interface ScoutingStore {
  /** Team rows plus the feed cursor they were built from, and every pit team name. */
  fetchTeamAggregatesSnapshot(): Promise<{ teams: TeamAggregate[]; lastSeq: unknown; names: Record<string, string> }>;
  /** One team's documents, already reduced to the privacy allow-list. */
  queryDashboardDocuments(kind: "matches" | "pit" | "reports", team: number): Promise<{ _default: Record<string, unknown> }[]>;
  /** Match submissions per scout name (admin only). */
  scoutActivity(): Promise<Map<string, { submissions: number; lastSubmittedAt: string | null }>>;
}

const BACKENDS: Record<ScoutingBackend, ScoutingStore> = { syncGateway };

/** The backend chosen by `storage.scouting` in app.config.ts. */
export const scoutingStore: ScoutingStore = BACKENDS[appConfig.storage.scouting];
