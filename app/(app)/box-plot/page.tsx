// /box-plot — the spread of a statistic across the event. Title and description come from `navigation` in
// app.config.ts.
import { LivePage } from "@/components/dashboard/live-page";
import { MetricBoard } from "@/components/dashboard/metric-board";

export default function BoxPlotPage() {
  return <LivePage href="/box-plot">{({ teams }) => <MetricBoard teams={teams} initialStat="fuelscored" />}</LivePage>;
}
