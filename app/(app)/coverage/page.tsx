// /coverage — how complete our scouting is, so the scout lead knows who needs more eyes. Title and description
// come from app.config.ts.
import { CoverageLive } from "@/components/dashboard/coverage";
import { LivePage } from "@/components/dashboard/live-page";

export default function CoveragePage() {
  return <LivePage href="/coverage" width="max-w-[960px]">{({ teams }) => <CoverageLive teams={teams} />}</LivePage>;
}
