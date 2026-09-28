import { connection } from "next/server";
import { MetricBoard } from "@/components/metrics/metric-board";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/realtime/realtime-connection";

export default async function AveragesPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();

  return (
    <>
    <RealtimeConnection initialCursor={lastSeq} initialNames={names} />
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
