// GET /api/admin/audit — the audit log, newest first, with filters and paging. Needs `audit:read`. There is
// deliberately no way to write or delete entries here.
import { listAudit, type AuditResult } from "@/lib/auth/audit";
import { guard, json, jsonError } from "@/lib/auth/requests";
import { authRuntime } from "@/lib/auth/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS = new Set(["success", "denied", "failure"]);

/** Read-only, newest first. There is deliberately no write, edit, or delete route for audit entries. */
export async function GET(request: Request) {
  const checked = await guard(request, { permission: "audit:read", action: "audit.read" });
  if (!checked.ok) return checked.response;
  const auth = authRuntime();
  if (!auth.ok) return jsonError(503, "auth_unavailable", "Sign-in is not configured");
  const query = new URL(request.url).searchParams;
  const before = query.get("before");
  if (before && !/^audit_\d{14}_[0-9a-f]{10}$/.test(before)) return jsonError(400, "invalid", "before must be an audit entry id");
  const result = query.get("result");
  const limit = Number(query.get("limit") ?? 50);
  const page = await listAudit(auth.store, {
    before: before ?? undefined,
    action: query.get("action")?.slice(0, 64) || undefined,
    result: result && RESULTS.has(result) ? result as AuditResult : undefined,
    search: query.get("q")?.slice(0, 100) || undefined,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return json(page);
}
