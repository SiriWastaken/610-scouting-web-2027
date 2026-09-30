'use client';


import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TeamAggregate, TeamSortKey } from "@/types/scouting";

const columns: { key: TeamSortKey; label: string; format?: (value: number) => string }[] = [
  { key: "rank", label: "Rank" },
  { key: "autoPpg", label: "Auto PPG", format: (value) => value.toFixed(1) },
  { key: "teleopPpg", label: "Tele PPG", format: (value) => value.toFixed(1) },
  { key: "endgamePpg", label: "Endgame", format: (value) => value.toFixed(1) },
  { key: "fuelPerMatch", label: "Fuel / match", format: (value) => value.toFixed(1) },
  { key: "fuelAccuracy", label: "Fuel acc.", format: (value) => `${value}%` },
];

export function DataTable({ teams, compact = false }: { teams: TeamAggregate[]; compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TeamSortKey>("rank");
  const [ascending, setAscending] = useState(true);
  

  const filtered = useMemo(() => teams.filter((team) => `${team.team} ${team.name}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    const result = a[sortKey] - b[sortKey];
    return ascending ? result : -result;
  }), [ascending, query, sortKey, teams]);

  function changeSort(key: TeamSortKey) {
    if (key === sortKey) setAscending((value) => !value);
    else { setSortKey(key); setAscending(true); }
  }

  return <section className="overflow-hidden border border-line bg-surface">
    <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{filtered.length} teams indexed</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search team or name" className="h-8 w-full border border-line bg-surface px-3 text-xs text-ink outline-none placeholder:text-muted focus:border-accent sm:w-56" />
    </div>
    {teams.length === 0 ? <div className="border-t border-line px-4 py-12 text-center text-sm text-muted">No live aggregate data is available. Configure Couchbase to populate this table.</div> : <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-xs">
        <thead className="border-b border-line bg-surface-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
        
        
          <tr><th className="px-4 py-3">Team</th>{!compact && <th className="px-3 py-3">Matches</th>}{columns.map((column) => <th key={column.key} className="px-3 py-3 text-right font-normal"><button onClick={() => changeSort(column.key)} className="hover:text-accent-text">{column.label} {sortKey === column.key ? (ascending ? <ArrowUp className="inline h-3 w-3" aria-hidden="true" /> : <ArrowDown className="inline h-3 w-3" aria-hidden="true" />) : null}</button></th>)}</tr>
       
       
        </thead>
        
        
        <tbody>{filtered.map((team, index) => <tr key={team.team} className="border-t border-line hover:bg-surface-2">
          <td className="px-4 py-3"><Link href={`/teams/${team.team}`} className="flex items-center gap-3 hover:text-accent-text"><span className="font-mono text-accent-text">{team.team}</span><span className="text-ink">{team.name}</span></Link></td>
          {!compact && <td className="px-3 py-3 font-mono text-muted">{team.matches}</td>}
          {columns.map((column) => <td key={column.key} className={`px-3 py-3 text-right font-mono ${column.key === "rank" && index < 3 ? "text-accent-text" : "text-muted"}`}>{column.format ? column.format(team[column.key]) : team[column.key]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}