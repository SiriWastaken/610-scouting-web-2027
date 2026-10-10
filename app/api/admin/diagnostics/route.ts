// POST /api/admin/diagnostics — run all health checks now plus a write/read/delete test in the account store.
// Needs `ops:diagnose`.
import { recordAudit } from "@/lib/auth/audit";
import { guard, json } from "@/lib/auth/requests";
import { authRuntime } from "@/lib/auth/requests";
import { metricsSnapshot } from "@/lib/ops/metrics";
import { getHealth, overallStatus, persistenceRoundTrip, serverInfo } from "@/services/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs every health check now (not from cache, at most every 3 s) plus a
 * write/read/delete round trip in the account store. Never touches scouting data.
 */
export async function POST(request: Request) {
  const checked = await guard(request, { permission: "ops:diagnose", action: "ops.diagnostics" });
  if (!checked.ok) return checked.response;
  const [health, persistence] = await Promise.all([getHealth({ force: true }), persistenceRoundTrip()]);
  const checks = { ...health.checks, persistence };
  const auth = authRuntime();
  const { viewer } = checked;
  await recordAudit(auth.ok ? auth.store : null, { action: "ops.diagnostics", result: "success", actor: { id: viewer.userId, email: viewer.user.email, role: viewer.principal.role }, target: { type: "system" }, meta: { overall: overallStatus(checks), persistence: persistence.status } });
  return json({ server: serverInfo(), overall: overallStatus(checks), checkedAt: health.checkedAt, checks, snapshot: health.snapshot, metrics: metricsSnapshot() });
}
