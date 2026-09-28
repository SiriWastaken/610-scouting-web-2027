import type { MetricsSnapshot } from "@/lib/ops/metrics";
import type { Check, CheckStatus, serverInfo } from "@/services/health";
import type { snapshotStatus } from "@/services/couchbase";

export type { Check, CheckStatus };
export type CheckName = "api" | "syncGateway" | "couchbase" | "accountStore" | "realtime" | "auth" | "persistence";

/** GET /api/admin/overview (and POST /api/admin/diagnostics, which adds `persistence`). */
export interface Overview {
  server: ReturnType<typeof serverInfo>;
  overall: CheckStatus;
  checkedAt: number;
  checks: Partial<Record<CheckName, Check>> & Record<Exclude<CheckName, "persistence">, Check>;
  snapshot: ReturnType<typeof snapshotStatus>;
  metrics: MetricsSnapshot;
}
