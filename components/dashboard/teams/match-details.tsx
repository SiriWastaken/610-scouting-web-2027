'use client';

import { labelClass } from '@/components/ui/kit';
import type { MatchData } from '@/lib/data/team-documents';
import { AllianceTag, Section } from './primitives';

export function MatchDetails({ match }: { match: MatchData }) {
  const climb = match.teleop?.L3hang ? 'L3' : match.teleop?.L2hang ? 'L2' : match.teleop?.L1hang ? 'L1' : '-';

  return (
    <Section
      title={`Match ${match.start?.match ?? 'N/A'}`}
     
      aside={<AllianceTag alliance={match.start?.alliance} />}
    >
      <dl className="grid grid-cols-2 gap-px bg-line">
        <div className="bg-surface px-4 py-3 sm:px-5">
          <dt className={labelClass}>Scout</dt>
          <dd className="mt-1 truncate text-sm font-medium text-ink">{match.start?.scoutName || 'Unknown'}</dd>
        </div>
        <div className="bg-surface px-4 py-3 sm:px-5">
          <dt className={labelClass}>Position</dt>
          <dd className="mt-1 text-sm font-medium text-ink">{match.start?.position?.toUpperCase() || 'Unknown'}</dd>
        </div>
        <div className="bg-surface px-4 py-3 sm:px-5">
          <dt className={`${labelClass} !text-teleop`}>Fuel scored</dt>
          <dd className="mt-0.5 text-[28px] font-semibold leading-8 tracking-[-0.01em] text-ink">{match.teleop?.fuelscored ?? 0}</dd>
        </div>
        <div className="bg-surface px-4 py-3 sm:px-5">
          <dt className={`${labelClass} !text-endgame`}>Climb</dt>
          <dd className="mt-0.5 text-[28px] font-semibold leading-8 tracking-[-0.01em] text-ink">{climb}</dd>
        </div>
      </dl>

      <div className="border-t border-line px-4 py-3 sm:px-5">
        <p className={labelClass}>Match notes</p>
        <p className={`mt-1 text-sm leading-6 ${match.teleop?.general ? 'text-ink' : 'text-muted'}`}>
          {match.teleop?.general || 'The scout left no notes for this match.'}
        </p>
      </div>
    </Section>
  );
}
