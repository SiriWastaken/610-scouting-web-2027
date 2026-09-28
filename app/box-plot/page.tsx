import { connection } from "next/server";
import { MetricBoard } from "@/components/metrics/metric-board";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/realtime/realtime-connection";

export default async function BoxPlotPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();

  return (
    <>
    <RealtimeConnection initialCursor={lastSeq} initialNames={names} />
    <MetricBoard
      teams={teams}
      initialStat="fuelscored"
      eyebrow="03 / DISTRIBUTION VIEW"
      title="Box Plot"
      description="Compare the spread of a scouting statistic across the event. Select a column heading to reorder the board."
    />
    </>
  );
}
