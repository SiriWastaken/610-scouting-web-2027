import { LivePage } from "@/components/dashboard/live-page";
import { MetricBoard } from "@/components/dashboard/metric-board";

export default function BoxPlotPage() {
  return <LivePage href="/box-plot">{({ teams }) => <MetricBoard teams={teams} initialStat="fuelscored" />}</LivePage>;
}
