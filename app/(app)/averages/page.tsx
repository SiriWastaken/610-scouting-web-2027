import { LivePage } from "@/components/dashboard/live-page";
import { MetricBoard } from "@/components/dashboard/metric-board";

export default function AveragesPage() {
  return <LivePage href="/averages">{({ teams }) => <MetricBoard teams={teams} initialStat="matchesPlayed" />}</LivePage>;
}
