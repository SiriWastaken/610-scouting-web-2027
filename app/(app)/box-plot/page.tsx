import { connection } from "next/server";
import { requirePage } from "@/lib/auth/pages";
import { AccessDenied, PageHeader } from "@/components/ui/kit";
import { MetricBoard } from "@/components/dashboard/metric-board";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/dashboard/live-status";

export default async function BoxPlotPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();

  return (
    <MetricBoard
      teams={teams}
      initialStat="fuelscored"
      header={<PageHeader title="Box Plot" description="Compare the spread of a scouting statistic across the event. Tap a column heading to rank the board." aside={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />} />}
    />
  );
}
