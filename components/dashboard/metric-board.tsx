// The Averages and Box Plot table: every team, every statistic, sortable. The columns come from
// `averagesColumns` in app.config.ts.
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Sigma } from "lucide-react";
import { buttonClass, EmptyState, selectClass, theadClass } from "@/components/ui/kit";
import type { TeamAggregate } from "@/types/scouting";
import { useAggregateRealtime } from "@/lib/realtime/hooks";
import { appConfig, type AverageColumn } from "@/app.config";

type StatKey = keyof TeamAggregate["rawData"];

const COLUMNS = appConfig.averagesColumns;

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

/** Teams without a usable value go last in either direction; returning 0 for mixed pairs made the comparator inconsistent and the order arbitrary. */
function sortTeams(teams: TeamAggregate[], sortKey: StatKey, ascending: boolean): TeamAggregate[] {
  return [...teams].sort((a, b) => {
    const av = a.rawData[sortKey];
    const bv = b.rawData[sortKey];
    const aNumeric = typeof av === "number" && Number.isFinite(av);
    const bNumeric = typeof bv === "number" && Number.isFinite(bv);
    if (!aNumeric || !bNumeric) return aNumeric === bNumeric ? 0 : aNumeric ? -1 : 1;
    return ascending ? av - bv : bv - av;
  });
}

/** Which statistic the table is sorted by and in which direction; choosing the active column again flips it. */
function useSort(initialStat: StatKey) {
  const [sortKey, setSortKey] = useState<StatKey>(initialStat);
  const [ascending, setAscending] = useState(true);
  const flip = () => setAscending((value) => !value);
  const sortBy = (key: StatKey) => {
    if (sortKey === key) flip();
    else { setSortKey(key); setAscending(true); }
  };
  return { sortKey, setSortKey, ascending, flip, sortBy };
}

interface MetricBoardProps {
  teams: TeamAggregate[];
  initialStat: StatKey;
}

/** The sortable statistics table. */
export function MetricBoard({ teams, initialStat }: MetricBoardProps) {
  const liveTeams = useAggregateRealtime(teams);
  const { sortKey, setSortKey, ascending, flip, sortBy } = useSort(initialStat);
  const sorted = useMemo(() => sortTeams(liveTeams, sortKey, ascending), [ascending, sortKey, liveTeams]);
  const sortedLabel = COLUMNS.find((stat) => stat.key === sortKey)?.label ?? "";

  return (
    <div>
      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Summary count={sorted.length} sortedLabel={sortedLabel} />
          <SortControls sortKey={sortKey} ascending={ascending} onSortKey={setSortKey} onFlip={flip} />
        </div>

        {sorted.length === 0 ? (
          <EmptyState icon={Sigma} title="No averages yet">
            No live aggregate data is available. Once scouted matches sync (and Couchbase is configured), every team shows up here.
          </EmptyState>
        ) : (
          <MetricTable teams={sorted} sortKey={sortKey} ascending={ascending} onSort={sortBy} />
        )}
      </section>
    </div>
  );
}

function Summary({ count, sortedLabel }: { count: number; sortedLabel: string }) {
  return (
    <div className="text-sm text-muted">
      <span className="font-semibold text-ink">{count} teams indexed</span>
      {count > 0 && <> · ranked by <span className="text-accent-text">{sortedLabel}</span></>}
    </div>
  );
}

const DirectionIcon = ({ ascending, className }: { ascending: boolean; className: string }) => (ascending ? <ArrowUp className={className} aria-hidden="true" /> : <ArrowDown className={className} aria-hidden="true" />);

function SortControls({ sortKey, ascending, onSortKey, onFlip }: { sortKey: StatKey; ascending: boolean; onSortKey: (key: StatKey) => void; onFlip: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <select aria-label="Sort statistics by" value={sortKey} onChange={(event) => onSortKey(event.target.value as StatKey)} className={`${selectClass} sm:w-64`}>
        {COLUMNS.map((stat) => (
          <option key={stat.key} value={stat.key}>
            {stat.label} {stat.suffix ?? ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={onFlip} className={`${buttonClass} shrink-0 whitespace-nowrap`} title="Switch sort direction">
        <DirectionIcon ascending={ascending} className="h-4 w-4" />{ascending ? "Lowest first" : "Highest first"}
      </button>
    </div>
  );
}

function MetricTable({ teams, sortKey, ascending, onSort }: { teams: TeamAggregate[]; sortKey: StatKey; ascending: boolean; onSort: (key: StatKey) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead className={theadClass}>
          <tr>
            <th className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left">Team</th>
            {COLUMNS.map((stat) => <MetricHead key={stat.key} stat={stat} active={stat.key === sortKey} ascending={ascending} onSort={() => onSort(stat.key)} />)}
          </tr>
        </thead>
        <tbody>{teams.map((team) => <MetricRow key={team.team} team={team} sortKey={sortKey} />)}</tbody>
      </table>
    </div>
  );
}

function MetricHead({ stat, active, ascending, onSort }: { stat: AverageColumn; active: boolean; ascending: boolean; onSort: () => void }) {
  return (
    <th className={`px-3 py-2.5 text-right align-bottom ${active ? "bg-accent-muted text-accent-text" : ""}`} aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}>
      <button type="button" aria-label={`Sort by ${stat.label}`} onClick={onSort} className="inline-flex max-w-[9rem] items-end justify-end gap-1 text-right hover:text-ink">
        <span>{stat.label} {stat.suffix ?? ""}</span>
        {active && <DirectionIcon ascending={ascending} className="h-3.5 w-3.5 shrink-0" />}
      </button>
    </th>
  );
}

function MetricRow({ team, sortKey }: { team: TeamAggregate; sortKey: StatKey }) {
  return (
    <tr className="group border-t border-line">
      <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 group-hover:bg-surface-2">
        <Link href={`/teams/${team.team}`} className="flex items-baseline gap-2.5 hover:text-accent-text">
          <span className="font-mono font-semibold text-accent-text">{team.team}</span>
          <span className="max-w-[12rem] truncate text-ink">{team.name}</span>
        </Link>
      </td>
      {COLUMNS.map((stat) => (
        <td key={stat.key} className={`whitespace-nowrap px-3 py-2.5 text-right font-mono group-hover:bg-surface-2 ${stat.key === sortKey ? "bg-accent-muted/50 font-semibold text-ink" : "text-ink-2"}`}>
          {formatValue(team.rawData[stat.key])}{stat.suffix ?? ""}
        </td>
      ))}
    </tr>
  );
}
