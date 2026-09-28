import { MetricBoard } from "@/components/metrics/metric-board";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/realtime/realtime-connection";

export default async function AveragesPage() {
  const { teams, lastSeq } = await fetchTeamAggregatesSnapshot();

  return (
    <>
    <RealtimeConnection initialCursor={lastSeq} />
    <MetricBoard
      teams={teams}
      initialStat="matchesPlayed"
      eyebrow="02 / AGGREGATE DATA"
      title="Averages"
      description="Event-wide performance averages calculated from the current scouting sample. Select a column heading to reorder the board."
    />
    </>
  );
}
