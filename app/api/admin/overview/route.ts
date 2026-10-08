// GET /api/admin/overview — everything the operations panel shows, in one response. Needs `ops:read`.
import { guard, json } from "@/lib/auth/requests";
import { metricsSnapshot } from "@/lib/ops/metrics";
import { getHealth, overallStatus, serverInfo } from "@/services/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the operations panel shows, in one response, so its tabs share a
 * single poll. Checks against Sync Gateway and the account store are cached
 * for 10 s server-side; counters are live.
 */
export async function GET(request: Request) {
  const checked = await guard(request, { permission: "ops:read", action: "ops.overview" });
  if (!checked.ok) return checked.response;
  const health = await getHealth();
  const metrics = metricsSnapshot();
  return json({ server: serverInfo(), overall: overallStatus(health.checks), ...health, metrics });
}
