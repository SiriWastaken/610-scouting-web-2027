import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchTeamAggregates } from "@/services/couchbase";

export default async function TeamDetailPage({ params }: { params: Promise<{ team: string }> }) {
  const { team: teamParam } = await params;
  const teamNumber = Number(teamParam);
  const team = (await fetchTeamAggregates()).find((candidate) => candidate.team === teamNumber);
  if (!team) notFound();

  const metrics = [
    ["Auto PPG", team.autoPpg.toFixed(1)],
    ["Teleop PPG", team.teleopPpg.toFixed(1)],
    ["Endgame PPG", team.endgamePpg.toFixed(1)],
    ["Fuel / match", team.fuelPerMatch.toFixed(1)],
    ["Fuel accuracy", `${team.fuelAccuracy}%`],
    ["Driver skill", `${team.driverSkill.toFixed(1)} / 10`],
    ["Defense rating", `${team.defenseRating.toFixed(1)} / 5`],
    ["Break rate", `${team.breakRate}%`],
  ];

  return <div className="mx-auto max-w-[1120px]">
    <Link href="/teams" className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)] hover:text-[var(--green)]">Back to teams</Link>
    <div className="mt-7 flex flex-col justify-between gap-5 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end"><div><div className="font-mono text-sm text-[var(--green)]">TEAM {team.team}</div><h1 className="mt-2 text-3xl font-medium tracking-tight">{team.name}</h1><p className="mt-2 text-sm text-[var(--muted)]">Aggregate scouting profile from {team.matches} observed matches.</p></div><div className="flex gap-8"><div><div className="font-mono text-2xl text-[var(--green)]">#{team.rank || "--"}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">rank</div></div><div><div className="font-mono text-2xl text-[var(--foreground)]">{team.matches}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">matches</div></div></div></div>
    <section className="mt-7 border border-[var(--line)] bg-[var(--panel)]"><div className="border-b border-[var(--line)] px-5 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">Performance signals</div><div className="grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="bg-[var(--panel)] px-5 py-5"><div className="font-mono text-lg text-[var(--foreground)]">{value}</div><div className="mt-2 text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div></div>)}</div></section>
    <div className="mt-5 border-l-2 border-[var(--green-strong)] bg-[var(--panel)] px-5 py-4 text-sm text-[var(--muted)]">This profile is computed from the current aggregate record. Match-level notes and pit details can be added here as the web data contract expands.</div>
  </div>;
}