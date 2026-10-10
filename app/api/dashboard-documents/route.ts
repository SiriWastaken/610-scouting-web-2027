// GET /api/dashboard-documents?kind=matches|pit|reports&team=<n> — one team's documents, reduced to the
// privacy allow-list. Needs `dashboard:read`.
import { guard } from "@/lib/auth/requests";
import { scoutingStore } from "@/services/scouting-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kinds = new Set(["matches", "pit", "reports"]);
export async function GET(request: Request) {
  const checked = await guard(request, { permission: "dashboard:read", action: "dashboard.read" });
  if (!checked.ok) return checked.response;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const team = Number(url.searchParams.get("team"));
  if (!kind || !kinds.has(kind) || !Number.isSafeInteger(team) || team <= 0 || team > 99999) {
    return Response.json({ error: "Invalid dashboard document query" }, { status: 400 });
  }
  const documents = await scoutingStore.queryDashboardDocuments(kind as "matches" | "pit" | "reports", team);
  return Response.json({ documents }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
