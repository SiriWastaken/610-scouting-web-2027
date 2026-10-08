import { connection } from "next/server";
import { requirePage } from "@/lib/auth/pages";
import { AccessDenied, PageHeader } from "@/components/ui/kit";
import { MetricBoard } from "@/components/dashboard/metric-board";
import { scoutingStore } from "@/services/scouting-store";
import { RealtimeConnection } from "@/components/dashboard/live-status";

export default async function AveragesPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teams, lastSeq, names } = await scoutingStore.fetchTeamAggregatesSnapshot();

  return (
    <MetricBoard
      teams={teams}
      initialStat="matchesPlayed"
      header={<PageHeader title="Averages" description="Every team, every stat, averaged across the matches we have scouted. Tap a column heading to rank the board." aside={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />} />}
    />
  );
}
