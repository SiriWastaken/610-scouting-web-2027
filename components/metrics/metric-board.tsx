"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TeamAggregate } from "@/types/scouting";
import { useAggregateRealtime } from "@/lib/use-realtime";

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
  eyebrow,
  title,
  description,
}: {
  teams: TeamAggregate[];
  initialStat: StatKey;
  eyebrow: string;
  title: string;
  description: string;
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

  return (
    <div className="mx-auto max-w-[1320px]">
      <div className="mb-7 max-w-2xl">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">{eyebrow}</div>
        <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
      </div>

      <section className="overflow-hidden border border-[var(--line)] bg-[var(--panel)]">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {sorted.length} teams indexed
          </div>
          <select
            aria-label="Sort statistics by"
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as StatKey)}
            className="h-8 w-full border border-[var(--line)] bg-[#0f1513] px-3 text-xs text-[var(--foreground)] outline-none focus:border-[var(--green-strong)] sm:w-auto"
          >
            {rawStatLabels.map((stat) => (
              <option key={stat.key} value={stat.key}>
                {stat.label} {stat.suffix ?? ""}
              </option>
            ))}
          </select>
        </div>

        {sorted.length === 0 ? (
          <div className="border-t border-[var(--line)] px-4 py-12 text-center text-sm text-[var(--muted)]">
            No live aggregate data is available. Configure Couchbase to populate this table.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-normal">Team</th>
                  {rawStatLabels.map((stat) => (
                    <th key={stat.key} className="px-3 py-3 text-right font-normal">
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
                        className="hover:text-[var(--green)]"
                      >
                        {stat.label} {stat.suffix ?? ""}
                        {sortKey === stat.key ? (ascending ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((team) => (
                  <tr key={team.team} className="border-t border-[var(--line)] hover:bg-[var(--panel-raised)]">
                    <td className="px-4 py-3">
                      <Link href={`/teams/${team.team}`} className="flex items-center gap-3 hover:text-[var(--green)]">
                        <span className="font-mono text-[var(--green)]">{team.team}</span>
                        <span className="text-[var(--foreground)]">{team.name}</span>
                      </Link>
                    </td>
                    {rawStatLabels.map((stat) => (
                      <td
                        key={stat.key}
                        className={`px-3 py-3 text-right font-mono ${
                          stat.key === sortKey ? "text-[var(--green)]" : "text-[var(--muted)]"
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
