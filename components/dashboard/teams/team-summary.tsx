// The team header on the Teams page: number, name, rank, matches and the eight aggregate statistics.
'use client';

import { labelClass } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';

/** Team header and the eight aggregate statistics. */
export function TeamStatSummary({ team, nickname }: { team: TeamAggregate; nickname?: string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-[44px] font-semibold leading-[48px] tracking-[-0.02em] text-accent-text">{team.team}</span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{nickname || team.name}</p>
            {nickname && nickname !== team.name && <p className="truncate text-xs text-muted">{team.name}</p>}
          </div>
        </div>
        <div className="flex gap-6">
          <Headline label="Rank" value={team.rank ? `#${team.rank}` : '-'} />
          <Headline label="Matches" value={team.matches} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {statsOf(team).map((stat) => (
          <div key={stat.label} className="bg-surface px-4 py-3 sm:px-5">
            <dt className={labelClass}>{stat.label}</dt>
            <dd className={`mt-1 text-[22px] font-semibold leading-7 ${stat.tone ?? 'text-ink'}`}>{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Headline({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <p className="text-[28px] font-semibold leading-8 tracking-[-0.01em] text-ink">{value}</p>
    </div>
  );
}

// Phase colours match the match log, so "auto" looks the same everywhere.
function statsOf(team: TeamAggregate): { label: string; value: string | number; tone?: string }[] {
  return [
    { label: 'Auto PPG', value: team.autoPpg.toFixed(1), tone: 'text-auto' },
    { label: 'Teleop PPG', value: team.teleopPpg.toFixed(1), tone: 'text-teleop' },
    { label: 'Endgame PPG', value: team.endgamePpg.toFixed(1), tone: 'text-endgame' },
    { label: 'Fuel / Match', value: team.fuelPerMatch.toFixed(1) },
    { label: 'Fuel Accuracy', value: `${team.fuelAccuracy}%` },
    { label: 'Defense', value: team.defenseRating.toFixed(1) },
    { label: 'Driver Skill', value: team.driverSkill.toFixed(1) },
    { label: 'Break Rate', value: `${team.breakRate}%`, tone: team.breakRate >= 25 ? 'text-bad' : undefined },
  ];
}
