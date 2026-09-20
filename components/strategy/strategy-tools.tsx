"use client";

import { useState } from "react";
import type { TeamAggregate } from "@/types/scouting";

function optionLabel(team: TeamAggregate): string {
  return `${team.team} / ${team.name}`;
}

export function StrategyTools({ teams }: { teams: TeamAggregate[] }) {
  const [firstTeamNumber, setFirstTeamNumber] = useState(teams[0]?.team ?? 0);
  const [secondTeamNumber, setSecondTeamNumber] = useState(teams[1]?.team ?? teams[0]?.team ?? 0);
  const [thirdTeamNumber, setThirdTeamNumber] = useState(teams[2]?.team ?? teams[0]?.team ?? 0);
  const first = teams.find((team) => team.team === firstTeamNumber);
  const second = teams.find((team) => team.team === secondTeamNumber);
  const third = teams.find((team) => team.team === thirdTeamNumber);
  const comparison = [first, second].filter((team): team is TeamAggregate => Boolean(team));
  const prediction = [first, second, third].filter((team): team is TeamAggregate => Boolean(team)).reduce((total, team) => total + team.autoPpg + team.teleopPpg + team.endgamePpg, 0);

  if (teams.length === 0) return <div className="border border-dashed border-[var(--line)] bg-[var(--panel)] p-8 text-sm text-[var(--muted)]">Strategy tools require live aggregate data. Configure Couchbase to enable team selection.</div>;

  return <div className="space-y-4">
    <section className="border border-[var(--line)] bg-[var(--panel)]"><div className="border-b border-[var(--line)] px-5 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--green)]">01 / Team comparison</div><p className="mt-1 text-sm text-[var(--muted)]">Compare the current aggregate signals for two teams.</p></div><div className="grid gap-4 p-5 md:grid-cols-2"><TeamSelect label="Team A" value={firstTeamNumber} teams={teams} onChange={setFirstTeamNumber} /><TeamSelect label="Team B" value={secondTeamNumber} teams={teams} onChange={setSecondTeamNumber} /></div>{comparison.length === 2 && <div className="overflow-x-auto border-t border-[var(--line)]"><table className="w-full min-w-[520px] text-left text-xs"><thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]"><tr><th className="px-5 py-3 font-normal">Signal</th>{comparison.map((team) => <th key={team.team} className="px-5 py-3 text-right font-normal">{optionLabel(team)}</th>)}</tr></thead><tbody>{[["Auto PPG", "autoPpg"], ["Teleop PPG", "teleopPpg"], ["Endgame PPG", "endgamePpg"], ["Fuel accuracy", "fuelAccuracy"], ["Driver skill", "driverSkill"], ["Defense rating", "defenseRating"]].map(([label, key]) => <tr key={key} className="border-t border-[var(--line)]"><td className="px-5 py-3 text-[var(--muted)]">{label}</td>{comparison.map((team) => <td key={team.team} className="px-5 py-3 text-right font-mono text-[var(--foreground)]">{team[key as keyof TeamAggregate] as number}{key === "fuelAccuracy" ? "%" : ""}</td>)}</tr>)}</tbody></table></div>}</section>
    <section className="border border-[var(--line)] bg-[var(--panel)]"><div className="border-b border-[var(--line)] px-5 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--green)]">02 / Match prediction</div><p className="mt-1 text-sm text-[var(--muted)]">A transparent baseline using the selected alliance&apos;s average scoring components.</p></div><div className="grid gap-4 p-5 md:grid-cols-3"><TeamSelect label="Alliance 1" value={firstTeamNumber} teams={teams} onChange={setFirstTeamNumber} /><TeamSelect label="Alliance 2" value={secondTeamNumber} teams={teams} onChange={setSecondTeamNumber} /><TeamSelect label="Alliance 3" value={thirdTeamNumber} teams={teams} onChange={setThirdTeamNumber} /></div><div className="flex items-end justify-between border-t border-[var(--line)] px-5 py-5"><div><div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">Estimated alliance score</div><div className="mt-1 font-mono text-3xl text-[var(--green)]">{prediction.toFixed(1)}</div></div><div className="max-w-xs text-right text-xs leading-5 text-[var(--muted)]">Auto + teleop + endgame PPG. This is a scouting baseline, not a match simulation.</div></div></section>
  </div>;
}

function TeamSelect({ label, value, teams, onChange }: { label: string; value: number; teams: TeamAggregate[]; onChange: (value: number) => void }) {
  return <label className="block"><span className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-9 w-full border border-[var(--line)] bg-[#0f1513] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--green-strong)]">{teams.map((team) => <option key={team.team} value={team.team}>{optionLabel(team)}</option>)}</select></label>;
}