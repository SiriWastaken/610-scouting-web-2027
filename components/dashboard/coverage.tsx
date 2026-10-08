"use client";

import { CircleCheck, CircleDashed, ClipboardCheck } from "lucide-react";
import { EmptyState, rowClass, StatTile, tableClass, theadClass, TileGrid } from "@/components/ui/kit";
import { useAggregateRealtime } from "@/lib/realtime/hooks";
import type { TeamAggregate } from "@/types/scouting";

export function CoverageLive({ teams: initialTeams }: { teams: TeamAggregate[] }) {
  const teams = useAggregateRealtime(initialTeams);
  const observedMatches = teams.reduce((total, team) => total + team.matches, 0);
  const completeTeams = teams.filter((team) => team.matches > 0 && team.rank > 0 && team.fuelAccuracy > 0).length;
  const quality = teams.length === 0 ? 0 : Math.round((completeTeams / teams.length) * 100);
  return <div className="space-y-5">
    <TileGrid columns="sm:grid-cols-3">
      <StatTile label="Teams with aggregates" value={String(teams.length)} />
      <StatTile label="Observed matches" value={String(observedMatches)} />
      <StatTile label="Complete records" value={`${quality}%`} tone={teams.length === 0 ? "normal" : quality >= 80 ? "good" : "warn"} hint={<span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${quality >= 80 ? "bg-good" : "bg-warn"}`} style={{ width: `${quality}%` }} /></span>} />
    </TileGrid>
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Aggregate record health</h2>
        {teams.length > 0 && <span className="text-xs text-muted">{completeTeams} of {teams.length} ready</span>}
      </div>
      {teams.length === 0 ? <EmptyState icon={ClipboardCheck} title="No records yet">No live aggregate data is available. Coverage fills in as scouted matches sync.</EmptyState> : <div className="overflow-x-auto"><table className={`${tableClass} min-w-[520px]`}>
        <thead className={theadClass}><tr><th className="px-5 py-2.5">Team</th><th className="px-4 py-2.5 text-right">Matches</th><th className="px-4 py-2.5 text-right">Rank</th><th className="px-5 py-2.5 text-right">Record</th></tr></thead>
        <tbody>{teams.map((team) => {
          const complete = team.matches > 0 && team.rank > 0 && team.fuelAccuracy > 0;
          return <tr key={team.team} className={rowClass}>
            <td className="px-5 py-2.5"><span className="font-mono font-semibold text-accent-text">{team.team}</span><span className="ml-3 text-ink">{team.name}</span></td>
            <td className="px-4 py-2.5 text-right font-mono text-ink-2">{team.matches}</td>
            <td className="px-4 py-2.5 text-right font-mono text-ink-2">{team.rank || "--"}</td>
            <td className="px-5 py-2.5 text-right"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${complete ? "text-good" : "text-warn"}`}>{complete ? <CircleCheck className="h-4 w-4" aria-hidden="true" /> : <CircleDashed className="h-4 w-4" aria-hidden="true" />}{complete ? "Ready" : "Check"}</span></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>
  </div>;
}
