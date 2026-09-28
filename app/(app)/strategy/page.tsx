import { connection } from "next/server";
import { requirePage } from "@/lib/auth/next";
import { AccessDenied } from "@/components/auth/access-denied";
import { StrategyTools } from "@/components/strategy/strategy-tools";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/realtime/realtime-connection";

export default async function StrategyPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();
  return <div className="mx-auto max-w-[1080px]">
    <RealtimeConnection initialCursor={lastSeq} initialNames={names} />
    <div className="mb-9 max-w-2xl"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">03 / DECISION SUPPORT</div><h1 className="text-3xl font-medium tracking-tight">Strategy Tools</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">A home for scouting analysis used before and between matches. Tools will read from the same aggregate dataset as Teams and Averages.</p></div>
    <StrategyTools teams={teams} />
  </div>;
}
