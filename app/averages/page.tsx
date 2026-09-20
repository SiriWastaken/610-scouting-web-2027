import { useMemo, useState, useEffect } from "react";
import type { TeamAggregate } from "@/types/scouting";
import { fetchTeamAggregates } from "@/services/couchbase";

type StatLabel = {
  key: keyof TeamAggregate["rawData"];
  label: string;
  suffix?: string;
};

const rawStatLabels: StatLabel[] = [
  { key: "avgDefenseSkill", label: "Average defense skill", suffix: "/ 5" },
  { key: "breakSeverity", label: "Break severity", suffix: "" },
  { key: "bumpCrossed", label: "Bumps crossed", suffix: "" },
  { key: "fuelPlowed", label: "Fuel plowed / match", suffix: "" },
  { key: "fuelpassed", label: "Fuel passed / match", suffix: "" },
  { key: "fuelscored", label: "Fuel scored / match", suffix: "" },
  { key: "teleopFuelFed", label: "Teleop fuel fed", suffix: "" },
  { key: "trenchCrossed", label: "Trenches crossed", suffix: "" },
  { key: "L1accuracy", label: "L1 accuracy", suffix: "%" },
  { key: "L2accuracy", label: "L2 accuracy", suffix: "%" },
  { key: "L3accuracy", label: "L3 accuracy", suffix: "%" },
  { key: "aStopAvg", label: "Average A-stop", suffix: "" },
  { key: "autoFuelaccuracy", label: "Auto fuel accuracy", suffix: "%" },
  { key: "autoL1accuracy", label: "Auto L1 accuracy", suffix: "%" },
  { key: "autoPPG", label: "Auto PPG", suffix: "" },
  { key: "avgDriverSkill", label: "Average driver skill", suffix: "/ 10" },
  { key: "brokePercentage", label: "Broke percentage", suffix: "%" },
  { key: "endgamePPG", label: "Endgame PPG", suffix: "" },
  { key: "fuelfed", label: "Fuel fed", suffix: "" },
  { key: "matchesPlayed", label: "Matches played", suffix: "" },
  { key: "standing", label: "Standing", suffix: "" },
  { key: "teleopPPG", label: "Teleop PPG", suffix: "" },
  { key: "totalFuelPassed", label: "Total fuel passed", suffix: "" },
  { key: "totalFuelPlowed", label: "Total fuel plowed", suffix: "" },
  { key: "L1AverageHangTime", label: "L1 average hang time", suffix: "s" },
  { key: "L2AverageHangTime", label: "L2 average hang time", suffix: "s" },
  { key: "L3AverageHangTime", label: "L3 average hang time", suffix: "s" },
  { key: "playedDefenseMatches", label: "Played defense matches", suffix: "" },
  { key: "teleopFuelaccuracy", label: "Teleop fuel accuracy", suffix: "%" },
  { key: "weightedBrokePercentage", label: "Weighted broke percentage", suffix: "%" },
] as const;

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

export default function AveragesPage() {
  const [teams, setTeams] = useState<TeamAggregate[]>([]);
  const [sortKey, setSortKey] = useState<keyof TeamAggregate["rawData"]>("matchesPlayed");
  const [ascending, setAscending] = useState(true);

  useEffect(() => {
    fetchTeamAggregates().then(setTeams);
  }, []);

  const sorted = useMemo(() => {
    return [...teams].sort((a, b) => {
      const av = a.rawData[sortKey];
      const bv = b.rawData[sortKey];
      if (typeof av !== "number" || typeof bv !== "number") return 0;
      return ascending ? av - bv : bv - av;
    });
  }, [sortKey, ascending, teams]);

  return <div className="mx-auto max-w-[1320px]">
    <div className="mb-7 max-w-2xl">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--green)]">02 / AGGREGATE DATA</div>
      <h1 className="text-3xl font-medium tracking-tight">Averages</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        Event-wide performance averages calculated from the current scouting sample. Select a column heading to reorder the board.
      </p>
    </div>

    <section className="overflow-hidden border border-[var(--line)] bg-[var(--panel)]">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">{sorted.length} teams indexed</div>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as keyof TeamAggregate["rawData"])}
          className="h-8 w-full border border-[var(--line)] bg-[#0f1513] px-3 text-xs text-[var(--foreground)] outline-none focus:border-[var(--green-strong)]"
        >
          {rawStatLabels.map((stat) => (
            <option key={stat.key} value={stat.key}>
              {humanize(stat.key)} {stat.suffix ?? ""}
            </option>
          ))}
        </select>
      </div>

      {sorted.length === 0
        ? <div className="border-t border-[var(--line)] px-4 py-12 text-center text-sm text-[var(--muted)]">
            No live aggregate data is available. Configure Couchbase to populate this table.
          </div>
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead className="bg-[#101613] font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-normal">Team</th>
                  {rawStatLabels.map((stat) => (
                    <th key={stat.key} className="px-3 py-3 text-right font-normal">
                      <button
                        onClick={() => setAscending((prev) => !prev)}
                        className="hover:text-[var(--green)]"
                      >
                        {humanize(stat.key)} {stat.suffix ?? ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((team) => (
                  <tr key={team.team} className="border-t border-[var(--line)] hover:bg-[var(--panel-raised)]">
                    <td className="px-4 py-3">
                      <a
                        href={`/teams/${team.team}`}
                        className="flex items-center gap-3 hover:text-[var(--green)]"
                      >
                        <span className="font-mono text-[var(--green)]">{team.team}</span>
                        <span className="text-[var(--foreground)]">{team.name}</span>
                      </a>
                    </td>
                    {rawStatLabels.map((stat) => (
                      <td
                        key={stat.key}
                        className={`px-3 py-3 text-right font-mono ${
                          stat.key === sortKey
                            ? ascending
                              ? "text-[var(--green)]"
                              : "text-[var(--foreground)]"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        {formatValue(team.rawData[stat.key])}{stat.suffix ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
    </section>
  </div>;
}