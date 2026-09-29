"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { labelClass } from "@/components/ui/kit";
import { useAggregateRealtime } from "@/lib/realtime/hooks";
import type { TeamAggregate } from "@/types/scouting";

export function TeamDetailLive({ team: initialTeam, live }: { team: TeamAggregate; live?: ReactNode }) {
  const initialTeams = useMemo(() => [initialTeam], [initialTeam]);
  const teams = useAggregateRealtime(initialTeams);
  const team = teams.find((candidate) => candidate.team === initialTeam.team) ?? initialTeam;
  // Phase colours match the rest of the app: auto amber, teleop teal, endgame violet.
  const metrics: [string, string, string?][] = [
    ["Auto PPG", team.autoPpg.toFixed(1), "text-auto"], ["Teleop PPG", team.teleopPpg.toFixed(1), "text-teleop"],
    ["Endgame PPG", team.endgamePpg.toFixed(1), "text-endgame"], ["Fuel / match", team.fuelPerMatch.toFixed(1)],
    ["Fuel accuracy", `${team.fuelAccuracy}%`], ["Driver skill", `${team.driverSkill.toFixed(1)} / 10`],
    ["Defense rating", `${team.defenseRating.toFixed(1)} / 5`], ["Break rate", `${team.breakRate}%`],
  ];
  return <div className="mx-auto max-w-[1120px]">
    <div className="flex items-center justify-between gap-3">
      <Link href="/teams" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-accent-text"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to teams</Link>
      {live}
    </div>
    <header className="mt-5 flex flex-col justify-between gap-5 border-b border-line pb-6 sm:flex-row sm:items-end">
      <div className="flex items-baseline gap-4">
        <span className="font-display text-6xl font-bold leading-none text-accent-text">{team.team}</span>
        <div>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">{team.name}</h1>
          <p className="mt-1 text-sm text-muted">Scouting profile from {team.matches} observed matches.</p>
        </div>
      </div>
      <div className="flex gap-8">
        <div><div className={labelClass}>Rank</div><div className="font-display text-4xl font-semibold leading-none">#{team.rank || "--"}</div></div>
        <div><div className={labelClass}>Matches</div><div className="font-display text-4xl font-semibold leading-none">{team.matches}</div></div>
      </div>
    </header>
    <section className="mt-6 overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">Performance signals</h2>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">{metrics.map(([label, value, tone]) => <div key={label} className="bg-surface px-5 py-4"><dt className={labelClass}>{label}</dt><dd className={`mt-1 font-mono text-xl font-semibold ${tone ?? "text-ink"}`}>{value}</dd></div>)}</dl>
    </section>
    <p className="mt-4 text-sm leading-6 text-muted">Want match-by-match detail, the pit interview, and cards? Open <Link href="/teams" className="font-medium text-accent-text hover:underline">Teams</Link> and pick {team.team}.</p>
  </div>;
}
