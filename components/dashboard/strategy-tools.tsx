"use client";

import { useState } from "react";
import { ArrowLeftRight, Calculator, ChevronUp, Target, type LucideIcon } from "lucide-react";
import { EmptyState, labelClass, rowClass, selectClass, theadClass } from "@/components/ui/kit";
import type { TeamAggregate } from "@/types/scouting";
import { useAggregateRealtime } from "@/lib/realtime/hooks";

function optionLabel(team: TeamAggregate): string {
  return `${team.team} / ${team.name}`;
}

export function StrategyTools({ teams: initialTeams }: { teams: TeamAggregate[] }) {
  const liveTeams = useAggregateRealtime(initialTeams);
  const teams = liveTeams;
  const [firstTeamNumber, setFirstTeamNumber] = useState(teams[0]?.team ?? 0);
  const [secondTeamNumber, setSecondTeamNumber] = useState(teams[1]?.team ?? teams[0]?.team ?? 0);
  const [thirdTeamNumber, setThirdTeamNumber] = useState(teams[2]?.team ?? teams[0]?.team ?? 0);
  const firstSelection = liveTeams.some((team) => team.team === firstTeamNumber) ? firstTeamNumber : liveTeams[0]?.team ?? 0;
  const secondSelection = liveTeams.some((team) => team.team === secondTeamNumber) ? secondTeamNumber : liveTeams[0]?.team ?? 0;
  const thirdSelection = liveTeams.some((team) => team.team === thirdTeamNumber) ? thirdTeamNumber : liveTeams[0]?.team ?? 0;
  const first = liveTeams.find((team) => team.team === firstSelection);
  const second = liveTeams.find((team) => team.team === secondSelection);
  const third = liveTeams.find((team) => team.team === thirdSelection);
  const comparison = [first, second].filter((team): team is TeamAggregate => Boolean(team));
  const prediction = [first, second, third].filter((team): team is TeamAggregate => Boolean(team)).reduce((total, team) => total + team.autoPpg + team.teleopPpg + team.endgamePpg, 0);

  if (liveTeams.length === 0) return <div className="rounded-lg border border-dashed border-line-strong bg-surface"><EmptyState icon={Target} title="Nothing to strategize with yet">Strategy tools need averages from scouted matches. They fill in as soon as data syncs.</EmptyState></div>;

  const alliance = [first, second, third].filter((team): team is TeamAggregate => Boolean(team));
  const biggest = Math.max(1, ...alliance.map((team) => team.autoPpg + team.teleopPpg + team.endgamePpg));

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <SectionHead icon={ArrowLeftRight} title="Head to head" description="Two teams' averages side by side. The stronger number in each row is marked." />
      <div className="grid gap-4 p-5 sm:grid-cols-2"><TeamSelect label="Team A" value={firstTeamNumber} teams={teams} onChange={setFirstTeamNumber} /><TeamSelect label="Team B" value={secondTeamNumber} teams={teams} onChange={setSecondTeamNumber} /></div>
      {comparison.length === 2 && <div className="overflow-x-auto border-t border-line"><table className="w-full min-w-[480px] text-left text-sm"><thead className={theadClass}><tr><th className="px-5 py-2.5">Signal</th>{comparison.map((team) => <th key={team.team} className="px-5 py-2.5 text-right normal-case tracking-normal"><span className="font-mono text-accent-text">{team.team}</span> <span className="font-medium text-ink-2">{team.name}</span></th>)}</tr></thead><tbody>{SIGNALS.map(([label, key, tone]) => {
        const values = comparison.map((team) => team[key] as number);
        const best = values[0] === values[1] ? null : values[0] > values[1] ? 0 : 1;
        return <tr key={key} className={rowClass}><td className={`px-5 py-3 font-medium ${tone ?? "text-ink-2"}`}>{label}</td>{comparison.map((team, index) => <td key={team.team} className={`px-5 py-3 text-right font-mono ${best === index ? "font-semibold text-good" : "text-ink-2"}`}>{best === index && <ChevronUp className="mr-1 inline h-4 w-4 align-[-3px]" aria-label="higher" />}{values[index]}{key === "fuelAccuracy" ? "%" : ""}</td>)}</tr>;
      })}</tbody></table></div>}
    </section>

    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <SectionHead icon={Calculator} title="Match prediction" description="A transparent baseline: add up the selected alliance's average points in each phase." />
      <div className="grid gap-4 p-5 sm:grid-cols-3"><TeamSelect label="Alliance 1" value={firstTeamNumber} teams={teams} onChange={setFirstTeamNumber} /><TeamSelect label="Alliance 2" value={secondTeamNumber} teams={teams} onChange={setSecondTeamNumber} /><TeamSelect label="Alliance 3" value={thirdTeamNumber} teams={teams} onChange={setThirdTeamNumber} /></div>
      <div className="grid gap-6 border-t border-line p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <ul className="space-y-3" aria-label="Points by robot">
          {alliance.map((team, index) => {
            const parts = [["Auto", team.autoPpg, "bg-auto"], ["Teleop", team.teleopPpg, "bg-teleop"], ["Endgame", team.endgamePpg, "bg-endgame"]] as const;
            const total = team.autoPpg + team.teleopPpg + team.endgamePpg;
            return <li key={`${team.team}-${index}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
              <span className="font-mono font-semibold text-ink">{team.team}</span>
              <span className="flex h-3 overflow-hidden rounded-full bg-surface-2" title={parts.map(([label, value]) => `${label} ${value.toFixed(1)}`).join(" · ")}>
                {parts.map(([label, value, color]) => <span key={label} className={color} style={{ width: `${(value / biggest) * 100}%` }} />)}
              </span>
              <span className="text-right font-mono text-ink-2">{total.toFixed(1)}</span>
            </li>;
          })}
          <li className="flex flex-wrap gap-x-4 gap-y-1 pl-[5.25rem] text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-auto" />Auto</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-teleop" />Teleop</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-endgame" />Endgame</span>
          </li>
        </ul>
        <div className="border-t border-line pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0 md:text-right">
          <div className={labelClass}>Estimated alliance score</div>
          <div className="mt-1 font-display text-5xl font-bold leading-none text-accent-text" data-alliance-score>{prediction.toFixed(1)}</div>
          <p className="mt-2 max-w-[16rem] text-xs leading-5 text-muted">Auto + teleop + endgame PPG. A scouting baseline, not a match simulation.</p>
        </div>
      </div>
    </section>
  </div>;
}

const SIGNALS: [string, keyof TeamAggregate, string?][] = [["Auto PPG", "autoPpg", "text-auto"], ["Teleop PPG", "teleopPpg", "text-teleop"], ["Endgame PPG", "endgamePpg", "text-endgame"], ["Fuel accuracy", "fuelAccuracy"], ["Driver skill", "driverSkill"], ["Defense rating", "defenseRating"]];

function SectionHead({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <div className="border-b border-line px-5 py-3.5"><h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 text-muted" aria-hidden="true" />{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>;
}

function TeamSelect({ label, value, teams, onChange }: { label: string; value: number; teams: TeamAggregate[]; onChange: (value: number) => void }) {
  const selected = teams.some((team) => team.team === value) ? value : teams[0]?.team ?? 0;
  return <label className="block"><span className={`mb-1.5 block ${labelClass}`}>{label}</span><select value={selected} onChange={(event) => onChange(Number(event.target.value))} className={selectClass}>{teams.map((team) => <option key={team.team} value={team.team}>{optionLabel(team)}</option>)}</select></label>;
}
