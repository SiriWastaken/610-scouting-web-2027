import { connection } from "next/server";
import { requirePage } from "@/lib/auth/pages";
import { AccessDenied } from "@/components/ui/kit";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/dashboard/live-status";
import { CoverageLive } from "@/components/dashboard/coverage";

export default async function CoveragePage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();

  return <div className="mx-auto max-w-[900px]">
    <div className="mb-9 max-w-2xl"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">05 / ADMINISTRATION</div><h1 className="text-3xl font-medium tracking-tight">Coverage</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">A read-only data quality view for the current event. Administrative controls can be added without changing the scouting workflows.</p></div>
    <RealtimeConnection initialCursor={lastSeq} initialNames={names} />
    <CoverageLive teams={teams} />
  </div>;
}
