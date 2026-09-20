import { useMemo, useState } from "react";
import Link from "next/link";
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

  return <section className="overflow-hidden border border-[var(--line)] bg-[var(--panel)]">
    <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">{filtered.length} teams indexed</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search team or name" className="h-8 w-full border border-[var(--line)] bg-[#0f1513] px-3 text-xs text-[var(--foreground)] outline-none placeholder:text-[#59675f] focus:border-[var(--green-strong)] sm:w-56" />
    </div>
    {teams.length === 0 ? <div className="border-t border-[var(--line)] px-4 py-12 text-center text-sm text-[var(--muted)]">No live aggregate data is available. Configure Couchbase to populate this table.</div> : <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-xs">
        <thead className="bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          <tr><th className="px-4 py-3 font-normal">Team</th>{!compact && <th className="px-3 py-3 font-normal">Matches</th>}{columns.map((column) => <th key={column.key} className="px-3 py-3 text-right font-normal"><button onClick={() => changeSort(column.key)} className="hover:text-[var(--green)]">{column.label} {sortKey === column.key ? (ascending ? "↑" : "↓") : ""}</button></th>)}</tr>
        </thead>
        <tbody>{filtered.map((team, index) => <tr key={team.team} className="border-t border-[var(--line)] hover:bg-[var(--panel-raised)]">
          <td className="px-4 py-3"><Link href={`/teams/${team.team}`} className="flex items-center gap-3 hover:text-[var(--green)]"><span className="font-mono text-[var(--green)]">{team.team}</span><span className="text-[var(--foreground)]">{team.name}</span></Link></td>
          {!compact && <td className="px-3 py-3 font-mono text-[var(--muted)]">{team.matches}</td>}
          {columns.map((column) => <td key={column.key} className={`px-3 py-3 text-right font-mono ${column.key === "rank" && index < 3 ? "text-[var(--green)]" : "text-[var(--muted)]"}`}>{column.format ? column.format(team[column.key]) : team[column.key]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}