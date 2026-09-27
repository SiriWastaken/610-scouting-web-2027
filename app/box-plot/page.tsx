import { MetricBoard } from "@/components/metrics/metric-board";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/realtime/realtime-connection";

export default async function BoxPlotPage() {
  const { teams, lastSeq } = await fetchTeamAggregatesSnapshot();

  return (
    <>
    <RealtimeConnection initialCursor={lastSeq} />
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
