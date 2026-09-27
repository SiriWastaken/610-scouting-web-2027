import { MetricBoard } from "@/components/metrics/metric-board";
import { fetchTeamAggregates } from "@/services/couchbase";

export default async function BoxPlotPage() {
  const teams = await fetchTeamAggregates();

  return (
    <MetricBoard
      teams={teams}
      initialStat="fuelscored"
      eyebrow="03 / DISTRIBUTION VIEW"
      title="Box Plot"
      description="Compare the spread of a scouting statistic across the event. Select a column heading to reorder the board."
    />
  );
}
