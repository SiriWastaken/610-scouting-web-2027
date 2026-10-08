import { connection } from "next/server";
import { requirePage } from "@/lib/auth/pages";
import { AccessDenied, PageHeader } from "@/components/ui/kit";
import { StrategyTools } from "@/components/dashboard/strategy-tools";
import { scoutingStore } from "@/services/scouting-store";
import { RealtimeConnection } from "@/components/dashboard/live-status";

export default async function StrategyPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teams, lastSeq, names } = await scoutingStore.fetchTeamAggregatesSnapshot();
  return <div className="mx-auto max-w-[1080px]">
    <PageHeader title="Strategy" description="Line teams up against each other before a match. Everything here reads from the same averages as Teams." aside={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />} />
    <StrategyTools teams={teams} />
  </div>;
}
