import { MetricBoard } from "@/components/metrics/metric-board";
import { fetchTeamAggregates } from "@/services/couchbase";

export default async function AveragesPage() {
  const teams = await fetchTeamAggregates();

  return (
    <MetricBoard
      teams={teams}
      initialStat="matchesPlayed"
      eyebrow="02 / AGGREGATE DATA"
      title="Averages"
      description="Event-wide performance averages calculated from the current scouting sample. Select a column heading to reorder the board."
    />
  );
}
