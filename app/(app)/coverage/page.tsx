import { connection } from "next/server";
import { requirePage } from "@/lib/auth/pages";
import { AccessDenied, PageHeader } from "@/components/ui/kit";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/dashboard/live-status";
import { CoverageLive } from "@/components/dashboard/coverage";

export default async function CoveragePage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();

  return <div className="mx-auto max-w-[960px]">
    <PageHeader title="Coverage" description="How complete our scouting is for this event, so the scout lead knows who still needs eyes on them." aside={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />} />
    <CoverageLive teams={teams} />
  </div>;
}
