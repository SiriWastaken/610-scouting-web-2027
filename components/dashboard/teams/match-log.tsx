'use client';

import { Ban, Check, ClipboardList, X } from 'lucide-react';
import { EmptyState } from '@/components/ui/kit';
import type { MatchData } from '@/lib/data/team-documents';
import { Section } from './primitives';

function RenderStatus({ success = 0, failure = 0 }: { success?: number; failure?: number }) {
  if (success > 0) return <Check className="mx-auto h-4 w-4 text-good" strokeWidth={3} aria-label="Succeeded" />;
  if (failure > 0) return <X className="mx-auto h-4 w-4 text-bad" strokeWidth={3} aria-label="Missed" />;
  return <span className="text-muted">-</span>;
}

export function MatchDataTable({ matches }: { matches: MatchData[] }) {
  if (!matches || matches.length === 0) {
    return (
      <Section title="Match Performance Log">
        <EmptyState icon={ClipboardList} title="No match data recorded yet.">
          Once a scout submits a match for this team it shows up here, live.
        </EmptyState>
      </Section>
    );
  }

  const thCls = 'px-2.5 py-2 text-center text-xs font-medium text-muted whitespace-nowrap';
  const groupCls = 'px-2.5 pt-2.5 pb-1.5 text-center text-xs font-semibold whitespace-nowrap border-t-[3px]';
  const tdCls = 'px-2.5 py-2.5 text-center whitespace-nowrap font-mono';

  return (
    <Section
      title="Match Performance Log"
     
      aside={<span className="text-xs font-medium text-muted">{matches.length} Matches</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${thCls} border-t-[3px] border-transparent text-left`} rowSpan={2}>
                Match
              </th>
              <th className={`${groupCls} border-auto text-auto`} colSpan={2}>
                Autonomous
              </th>
              <th className={`${groupCls} border-teleop text-teleop`} colSpan={4}>
                Teleop
              </th>
              <th className={`${groupCls} border-endgame text-endgame`} colSpan={4}>
                Endgame
              </th>
              <th className={`${groupCls} border-line-strong text-ink-2`} colSpan={3}>
                Status
              </th>
            </tr>
            <tr className="border-b border-line">
              <th className={thCls}>Score</th>
              <th className={thCls}>Fed</th>
              <th className={thCls}>Score</th>
              <th className={thCls}>Pass</th>
              <th className={thCls}>Fed</th>
              <th className={thCls}>Plow</th>
              <th className={thCls}>L1</th>
              <th className={thCls}>L2</th>
              <th className={thCls}>L3</th>
              <th className={thCls}>None</th>
              <th className={thCls}>Def?</th>
              <th className={thCls}>Broke</th>
              <th className={thCls}>Sev</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match, idx) => {
              const start = match.start || {};
              const auto = match.auto || {};
              const tele = match.teleop || {};
              const isBlue = start.alliance?.toLowerCase() === 'blue';
              const attemptedClimb =
                (tele.L1hang ?? 0) > 0 ||
                (tele.missedL1 ?? 0) > 0 ||
                (tele.L2hang ?? 0) > 0 ||
                (tele.missedL2 ?? 0) > 0 ||
                (tele.L3hang ?? 0) > 0 ||
                (tele.missedL3 ?? 0) > 0;

              return (
                <tr key={idx} className="border-t border-line transition-colors first:border-t-0 hover:bg-surface-2/70">
                  <td className={`${tdCls} text-left font-semibold text-ink`}>
                    <span
                      className={`mr-2 inline-block h-4 w-1.5 rounded-sm align-middle ${isBlue ? 'bg-alliance-blue' : 'bg-alliance-red'}`}
                      title={isBlue ? 'Blue alliance' : 'Red alliance'}
                    />
                    {start.match ?? '-'}
                  </td>
                  <td className={`${tdCls} font-semibold text-ink`}>{auto.fuelScored ?? 0}</td>
                  <td className={`${tdCls} text-muted`}>{auto.fuelFed ?? 0}</td>
                  <td className={`${tdCls} font-semibold text-ink`}>{tele.fuelscored ?? 0}</td>
                  <td className={`${tdCls} text-muted`}>{tele.fuelpassed ?? 0}</td>
                  <td className={`${tdCls} text-muted`}>{tele.teleopFuelFed ?? 0}</td>
                  <td className={`${tdCls} text-muted`}>{tele.fuelPlowed ?? 0}</td>
                  <td className={tdCls}>
                    <RenderStatus success={tele.L1hang} failure={tele.missedL1} />
                  </td>
                  <td className={tdCls}>
                    <RenderStatus success={tele.L2hang} failure={tele.missedL2} />
                  </td>
                  <td className={tdCls}>
                    <RenderStatus success={tele.L3hang} failure={tele.missedL3} />
                  </td>
                  <td className={tdCls}>
                    {!attemptedClimb ? (
                      <Ban className="mx-auto h-4 w-4 text-muted" aria-label="No climb attempted" />
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    {tele.playedDefense ? (
                      <span className="rounded-sm bg-accent-muted px-1.5 py-0.5 text-xs font-bold text-accent-text">DEF</span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    {tele.breakDuration ? (
                      <span className="font-semibold text-bad">{tele.breakDuration}s</span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className={`${tdCls} font-sans text-xs text-muted`}>{tele.breakSeverity || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
