// The Coverage page body: how complete each team's aggregate record is, built from the ScoutingEvent.
"use client";

import { CircleCheck, CircleDashed, ClipboardCheck } from "lucide-react";
import { EmptyState, rowClass, StatTile, tableClass, theadClass, TileGrid } from "@/components/ui/kit";
import type { ScoutingEvent } from "@/lib/domain/scouting-event";
import { useScoutingEvent } from "@/lib/realtime/hooks";
import type { TeamAggregate } from "@/types/scouting";

/** Coverage page body. Rebuilds the event as objects whenever live aggregates change. */
export function CoverageLive({ teams: initialTeams }: { teams: TeamAggregate[] }) {
  const event = useScoutingEvent(initialTeams);
  return <div className="space-y-5">
    <CoverageTiles event={event} />
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Aggregate record health</h2>
        {!event.isEmpty && <span className="text-xs text-muted">{event.completeTeams.length} of {event.size} ready</span>}
      </div>
      {event.isEmpty ? <EmptyState icon={ClipboardCheck} title="No records yet">No live aggregate data is available. Coverage fills in as scouted matches sync.</EmptyState> : <CoverageTable event={event} />}
    </section>
  </div>;
}

function CoverageTiles({ event }: { event: ScoutingEvent }) {
  const quality = event.coveragePercent;
  return <TileGrid columns="sm:grid-cols-3">
    <StatTile label="Teams with aggregates" value={String(event.size)} />
    <StatTile label="Observed matches" value={String(event.observedMatches)} />
    <StatTile label="Complete records" value={`${quality}%`} tone={event.isEmpty ? "normal" : quality >= 80 ? "good" : "warn"} hint={<span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${quality >= 80 ? "bg-good" : "bg-warn"}`} style={{ width: `${quality}%` }} /></span>} />
  </TileGrid>;
}

function CoverageTable({ event }: { event: ScoutingEvent }) {
  return <div className="overflow-x-auto"><table className={`${tableClass} min-w-[520px]`}>
    <thead className={theadClass}><tr><th className="px-5 py-2.5">Team</th><th className="px-4 py-2.5 text-right">Matches</th><th className="px-4 py-2.5 text-right">Rank</th><th className="px-5 py-2.5 text-right">Record</th></tr></thead>
    <tbody>{event.teams.map((team) => {
      const complete = team.hasCompleteRecord();
      return <tr key={team.number} className={rowClass}>
        <td className="px-5 py-2.5"><span className="font-mono font-semibold text-accent-text">{team.number}</span><span className="ml-3 text-ink">{team.name}</span></td>
        <td className="px-4 py-2.5 text-right font-mono text-ink-2">{team.matchesPlayed}</td>
        <td className="px-4 py-2.5 text-right font-mono text-ink-2">{team.rank || "--"}</td>
        <td className="px-5 py-2.5 text-right"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${complete ? "text-good" : "text-warn"}`}>{complete ? <CircleCheck className="h-4 w-4" aria-hidden="true" /> : <CircleDashed className="h-4 w-4" aria-hidden="true" />}{complete ? "Ready" : "Check"}</span></td>
      </tr>;
    })}</tbody>
  </table></div>;
}
