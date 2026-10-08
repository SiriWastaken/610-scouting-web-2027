// The panel for one scouted match: scout, position, fuel scored, climb and notes.
'use client';

import type { ReactNode } from 'react';
import { labelClass } from '@/components/ui/kit';
import type { Match } from '@/lib/domain/match';
import { AllianceTag, Section } from './primitives';

function Fact({ label, labelTone = '', big = false, children }: { label: string; labelTone?: string; big?: boolean; children: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3 sm:px-5">
      <dt className={`${labelClass} ${labelTone}`}>{label}</dt>
      <dd className={big ? 'mt-0.5 text-[28px] font-semibold leading-8 tracking-[-0.01em] text-ink' : 'mt-1 text-sm font-medium text-ink'}>{children}</dd>
    </div>
  );
}

/** One match's facts: scout, position, fuel, climb and notes. */
export function MatchDetails({ match }: { match: Match }) {
  const { start, teleop } = match;

  return (
    <Section title={`Match ${start?.match ?? 'N/A'}`} aside={<AllianceTag alliance={start?.alliance} />}>
      <dl className="grid grid-cols-2 gap-px bg-line">
        <Fact label="Scout"><span className="block truncate">{start?.scoutName || 'Unknown'}</span></Fact>
        <Fact label="Position">{start?.position?.toUpperCase() || 'Unknown'}</Fact>
        <Fact label="Fuel scored" labelTone="!text-teleop" big>{teleop?.fuelscored ?? 0}</Fact>
        <Fact label="Climb" labelTone="!text-endgame" big>{match.climbLevel}</Fact>
      </dl>

      <div className="border-t border-line px-4 py-3 sm:px-5">
        <p className={labelClass}>Match notes</p>
        <p className={`mt-1 text-sm leading-6 ${teleop?.general ? 'text-ink' : 'text-muted'}`}>
          {teleop?.general || 'The scout left no notes for this match.'}
        </p>
      </div>
    </Section>
  );
}
