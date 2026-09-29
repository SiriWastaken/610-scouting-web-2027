"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Sigma } from "lucide-react";
import { buttonClass, EmptyState, selectClass, theadClass } from "@/components/ui/kit";
import type { TeamAggregate } from "@/types/scouting";
import { useAggregateRealtime } from "@/lib/realtime/hooks";

type StatKey = keyof TeamAggregate["rawData"];

type StatLabel = {
  key: StatKey;
  label: string;
  suffix?: string;
};

const rawStatLabels: StatLabel[] = [
  { key: "avgDefenseSkill", label: "Average defense skill", suffix: "/ 5" },
  { key: "breakSeverity", label: "Break severity" },
  { key: "bumpCrossed", label: "Bumps crossed" },
  { key: "fuelPlowed", label: "Fuel plowed / match" },
  { key: "fuelpassed", label: "Fuel passed / match" },
  { key: "fuelscored", label: "Fuel scored / match" },
  { key: "teleopFuelFed", label: "Teleop fuel fed" },
  { key: "trenchCrossed", label: "Trenches crossed" },
  { key: "L1accuracy", label: "L1 accuracy", suffix: "%" },
  { key: "L2accuracy", label: "L2 accuracy", suffix: "%" },
  { key: "L3accuracy", label: "L3 accuracy", suffix: "%" },
  { key: "aStopAvg", label: "Average A-stop" },
  { key: "autoFuelaccuracy", label: "Auto fuel accuracy", suffix: "%" },
  { key: "autoL1accuracy", label: "Auto L1 accuracy", suffix: "%" },
  { key: "autoPPG", label: "Auto PPG" },
  { key: "avgDriverSkill", label: "Average driver skill", suffix: "/ 10" },
  { key: "brokePercentage", label: "Broke percentage", suffix: "%" },
  { key: "endgamePPG", label: "Endgame PPG" },
  { key: "fuelfed", label: "Fuel fed" },
  { key: "matchesPlayed", label: "Matches played" },
  { key: "standing", label: "Standing" },
  { key: "teleopPPG", label: "Teleop PPG" },
  { key: "totalFuelPassed", label: "Total fuel passed" },
  { key: "totalFuelPlowed", label: "Total fuel plowed" },
  { key: "L1AverageHangTime", label: "L1 average hang time", suffix: "s" },
  { key: "L2AverageHangTime", label: "L2 average hang time", suffix: "s" },
  { key: "L3AverageHangTime", label: "L3 average hang time", suffix: "s" },
  { key: "playedDefenseMatches", label: "Played defense matches" },
  { key: "teleopFuelaccuracy", label: "Teleop fuel accuracy", suffix: "%" },
  { key: "weightedBrokePercentage", label: "Weighted broke percentage", suffix: "%" },
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

export function MetricBoard({
  teams,
  initialStat,
  header,
}: {
  teams: TeamAggregate[];
  initialStat: StatKey;
  /** The page's header, rendered by the server page. */
  header: ReactNode;
}) {
  const liveTeams = useAggregateRealtime(teams);
  const [sortKey, setSortKey] = useState<StatKey>(initialStat);
  const [ascending, setAscending] = useState(true);

  const sorted = useMemo(
    () =>
      [...liveTeams].sort((a, b) => {
        const av = a.rawData[sortKey];
        const bv = b.rawData[sortKey];
        const aNumeric = typeof av === "number" && Number.isFinite(av);
        const bNumeric = typeof bv === "number" && Number.isFinite(bv);
        // Teams without a usable value go last in either direction; returning 0
        // for mixed pairs made the comparator inconsistent and the order arbitrary.
        if (!aNumeric || !bNumeric) return aNumeric === bNumeric ? 0 : aNumeric ? -1 : 1;
        return ascending ? av - bv : bv - av;
      }),
    [ascending, sortKey, liveTeams]
  );

  const sortedLabel = rawStatLabels.find((stat) => stat.key === sortKey)?.label ?? "";

  return (
    <div>
      {header}

      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted">
            <span className="font-semibold text-ink">{sorted.length} teams indexed</span>
            {sorted.length > 0 && <> · ranked by <span className="text-accent-text">{sortedLabel}</span></>}
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Sort statistics by"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as StatKey)}
              className={`${selectClass} sm:w-64`}
            >
              {rawStatLabels.map((stat) => (
                <option key={stat.key} value={stat.key}>
                  {stat.label} {stat.suffix ?? ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setAscending((value) => !value)} className={`${buttonClass} shrink-0 whitespace-nowrap`} title="Switch sort direction">
              {ascending ? <ArrowUp className="h-4 w-4" aria-hidden="true" /> : <ArrowDown className="h-4 w-4" aria-hidden="true" />}{ascending ? "Lowest first" : "Highest first"}
            </button>
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState icon={Sigma} title="No averages yet">
            No live aggregate data is available. Once scouted matches sync (and Couchbase is configured), every team shows up here.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-2 px-4 py-2.5 text-left">Team</th>
                  {rawStatLabels.map((stat) => {
                    const active = stat.key === sortKey;
                    return (
                      <th key={stat.key} className={`px-3 py-2.5 text-right align-bottom ${active ? "bg-accent-soft text-accent-text" : ""}`} aria-sort={active ? (ascending ? "ascending" : "descending") : undefined}>
                        <button
                          type="button"
                          aria-label={`Sort by ${stat.label}`}
                          onClick={() => {
                            if (sortKey === stat.key) setAscending((value) => !value);
                            else {
                              setSortKey(stat.key);
                              setAscending(true);
                            }
                          }}
                          className="inline-flex max-w-[9rem] items-end justify-end gap-1 text-right uppercase hover:text-ink"
                        >
                          <span>{stat.label} {stat.suffix ?? ""}</span>
                          {active && (ascending ? <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((team) => (
                  <tr key={team.team} className="group border-t border-line">
                    <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 group-hover:bg-surface-2">
                      <Link href={`/teams/${team.team}`} className="flex items-baseline gap-2.5 hover:text-accent-text">
                        <span className="font-mono font-semibold text-accent-text">{team.team}</span>
                        <span className="max-w-[12rem] truncate text-ink">{team.name}</span>
                      </Link>
                    </td>
                    {rawStatLabels.map((stat) => (
                      <td
                        key={stat.key}
                        className={`whitespace-nowrap px-3 py-2.5 text-right font-mono group-hover:bg-surface-2 ${
                          stat.key === sortKey ? "bg-accent-soft/50 font-semibold text-ink" : "text-ink-2"
                        }`}
                      >
                        {formatValue(team.rawData[stat.key])}{stat.suffix ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
