import { connection } from "next/server";
import { Sigma } from "lucide-react";
import { requirePage } from "@/lib/auth/pages";
import { AccessDenied, PageHeader } from "@/components/ui/kit";
import { MetricBoard } from "@/components/dashboard/metric-board";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/dashboard/live-status";

export default async function AveragesPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();

  return (
    <MetricBoard
      teams={teams}
      initialStat="matchesPlayed"
      header={<PageHeader icon={Sigma} tab="averages" title="Averages" description="Every team, every stat, averaged across the matches we have scouted. Tap a column heading to rank the board." aside={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />} />}
    />
  );
}
