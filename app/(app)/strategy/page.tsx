import { LivePage } from "@/components/dashboard/live-page";
import { StrategyTools } from "@/components/dashboard/strategy-tools";

export default function StrategyPage() {
  return <LivePage href="/strategy" width="max-w-[1080px]">{({ teams }) => <StrategyTools teams={teams} />}</LivePage>;
}
