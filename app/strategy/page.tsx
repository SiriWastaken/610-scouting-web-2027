import { StrategyTools } from "@/components/strategy/strategy-tools";
import { fetchTeamAggregates } from "@/services/couchbase";

export default async function StrategyPage() {
  const teams = await fetchTeamAggregates();
  return <div className="mx-auto max-w-[1080px]">
    <div className="mb-9 max-w-2xl"><div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">03 / DECISION SUPPORT</div><h1 className="text-3xl font-medium tracking-tight">Strategy Tools</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">A home for scouting analysis used before and between matches. Tools will read from the same aggregate dataset as Teams and Averages.</p></div>
    <StrategyTools teams={teams} />
  </div>;
}