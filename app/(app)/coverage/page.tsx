import { CoverageLive } from "@/components/dashboard/coverage";
import { LivePage } from "@/components/dashboard/live-page";

export default function CoveragePage() {
  return <LivePage href="/coverage" width="max-w-[960px]">{({ teams }) => <CoverageLive teams={teams} />}</LivePage>;
}
