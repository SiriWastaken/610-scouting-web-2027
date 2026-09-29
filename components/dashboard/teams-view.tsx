'use client';

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Ban,
  Bot,
  Check,
  ClipboardList,
  FileQuestion,
  Flag,
  ListOrdered,
  MessageSquareText,
  Play,
  RectangleVertical,
  RotateCcw,
  Route,
  ShieldCheck,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState, labelClass, rowClass, selectClass, tableClass, theadClass } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';
import { useAggregateRealtime, useRealtimeDocuments, useRealtimeResync } from '@/lib/realtime/hooks';
import { sanitizeMatchData } from '@/lib/data/match-data';

/**
 * Shape of the documents returned by `/api/dashboard-documents` (and the realtime feed).
 * Wraps loosely-typed document data without resorting to `any`.
 */
type RawDoc = {
  _default?: Record<string, unknown>;
  team?: string | number;
  teamNumber?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

function unwrapDoc(r: RawDoc): Record<string, unknown> {
  return (r._default ?? r) as Record<string, unknown>;
}

async function queryDashboardDocuments(kind: 'matches' | 'pit' | 'reports', team: number): Promise<RawDoc[]> {
  const response = await fetch(`/api/dashboard-documents?kind=${kind}&team=${team}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${kind} data (${response.status})`);
  const payload = await response.json() as { documents?: RawDoc[] };
  return payload.documents ?? [];
}

/**
 * Your scouting docs are keyed like `scouting_<teamNumber>_<matchNumber>`,
 * `pit_<teamNumber>`, and `aggregate_<teamNumber>` rather than by an explicit
 * team field, so team (and match) numbers are pulled from `_id` as a
 * fallback whenever the doc/data body doesn't have them directly.
 */
function parseScoutingId(id: unknown): { team?: string; match?: string } {
  if (typeof id !== 'string') return {};
  const match = id.match(/^(?:scouting|pit|aggregate|report(?:_card)?)_(\d+)(?:_(.+))?/);
  if (!match) return {};
  return { team: match[1], match: match[2] };
}

function docTeam(doc: Record<string, unknown>): string | undefined {
  const data = doc.data as Record<string, unknown> | undefined;
  const explicit = doc.team ?? doc.teamNumber ?? data?.team ?? data?.teamNumber;
  if (explicit !== undefined && explicit !== null) return String(explicit);
  return parseScoutingId(doc._id).team;
}

/** Stable empty input for realtime merges while REST data is loading. */
const NO_DOCS: Record<string, unknown>[] = [];

function toMatchData(doc: Record<string, unknown>): MatchData {
  // Fill in the match number from the doc id (`scouting_<team>_<match>`) if it
  // isn't already in the data, and drop values of the wrong type so one bad
  // submission cannot crash the page. Builds a copy: documents may be shared
  // with the realtime store.
  const { match: matchNum } = parseScoutingId(doc._id);
  return sanitizeMatchData(doc.data ?? doc, typeof doc._id === 'string' ? doc._id : undefined, matchNum && Number.isFinite(Number(matchNum)) ? Number(matchNum) : undefined);
}

/** Only strings and finite numbers are rendered; anything else from a malformed document falls back. */
function label(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  }
  return undefined;
}

function toCardReport(doc: Record<string, unknown>): CardReport {
  const data = (doc.data && typeof doc.data === 'object' ? doc.data : {}) as Record<string, unknown>;
  return {
    sourceId: String(doc._id ?? ''),
    match: label(doc.match, data.matchNumber) ?? 'N/A',
    team: label(doc.team, data.teamNumber) ?? 'N/A',
    cardType: label(data.cardType) ?? 'Unknown',
    ruleViolation: label(data.ruleViolation) ?? 'N/A',
    notes: label(data.notes) ?? 'None',
    timestamp: label(doc.timestamp, data.timestamp),
  };
}

/**
 * Your scouting-match docs are keyed `scouting_<teamNumber>_<matchNumber>`
 * (not distinguished by a `type` field), so we fetch by `_id` prefix instead.
 */
const MATCH_DOC_ID_PREFIX = 'scouting_';

/* ============================================================================
 * TYPES
 * ==========================================================================*/

interface MatchStart {
  match?: number;
  alliance?: string;
  position?: string;
  scoutName?: string;
  practice?: boolean;
}

interface MatchAuto {
  fuelScored?: number;
  fuelFed?: number;
  hangLevel?: number;
  markers?: { x: number; y: number; type: 'pickup' | 'scoring' }[];
  paths?: string[];
  fieldFlipped?: boolean;
}

interface MatchTeleop {
  fuelscored?: number;
  fuelpassed?: number;
  fuelPlowed?: number;
  teleopFuelFed?: number;
  L1hang?: number;
  missedL1?: number;
  L2hang?: number;
  missedL2?: number;
  L3hang?: number;
  missedL3?: number;
  playedDefense?: number;
  breakDuration?: number;
  breakSeverity?: number | string;
  general?: string;
}

interface MatchData {
  _id?: string;
  start?: MatchStart;
  auto?: MatchAuto;
  teleop?: MatchTeleop;
  teamNumber?: number | string;
}

interface CouchbaseBlob {
  content?: string;
  contentType?: string;
  data?: string;
  content_type?: string;
}

interface PitData {
  driveBase?: string;
  drivetrainType?: string;
  swerveOrientation?: string;
  driveMotors?: string;
  robotWeight?: string;
  robotHeight?: string;
  drivetrainDimensions?: string;
  openOrClosedTop?: string;
  typeOfShooter?: string;
  typeOfIndexer?: string;
  hopperCapacity?: string | number;
  funcIntake?: string;
  canDriveOverBump?: string;
  canGoUnderTrench?: string;
  scoringZones?: string;
  autonStartPosition?: string;
  climbCapability?: string;
  canPassFuel?: string;
  hasPassedBefore?: string;
  driverExperience?: string;
  driverYearsExperience?: number;
  defenseComfort?: number;
  defenseComfortDetailed?: number;
  humanPlayerConfidence?: number;
  hasRobotName?: string;
  robotName?: string;
  robotNameOrigin?: string;
  favoriteRobotPart?: string;
  teamFunFact?: string;
  teamGoals?: string;
  scoringZonesVerified?: string;
  hasVisionTracking?: string;
  scoringAids?: string;
  scoringAidsVerified?: string;
  robotJankOrTippy?: string;
  redFlags?: string;
  extraComments?: string;
  qualStrategy?: string;
  playoffStrategy?: string;
  robotUnique?: string;
  teamUnique?: string;
  idealAlliance?: string;
  robotPhoto?: string | CouchbaseBlob | null;
  scoutName?: string;
}

interface CardReport {
  sourceId?: string;
  match: string | number;
  team: string | number;
  cardType: string;
  ruleViolation: string;
  notes: string;
  timestamp?: string;
}

interface TeamsClientViewProps {
  initialTeams: TeamAggregate[];
  teamNames?: Record<number, string>;
}

/* ============================================================================
 * SMALL SHARED UI PRIMITIVES
 * ==========================================================================*/

function Section({
  title,
  icon: Icon,
  aside,
  children,
  className = '',
}: {
  title: string;
  icon?: LucideIcon;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-line bg-surface shadow-sm ${className}`}>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {Icon && <Icon className="h-4 w-4 text-muted" aria-hidden="true" />}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function NativeSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string | null;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
}) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${selectClass} h-11 text-base sm:text-sm`}>
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** A value in the alliance's colour, with the word, so it never relies on colour alone. */
function AllianceTag({ alliance }: { alliance?: string }) {
  const side = alliance?.toLowerCase();
  const color = side === 'blue' ? 'text-alliance-blue' : side === 'red' ? 'text-alliance-red' : 'text-muted';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] ${color}`}>
      <span className="h-3 w-1.5 rounded-sm bg-current" aria-hidden="true" />
      {side === 'blue' || side === 'red' ? `${side} alliance` : 'Alliance unknown'}
    </span>
  );
}

/* ============================================================================
 * TEAM SELECTOR
 * ==========================================================================*/

function TeamSelector({
  teams,
  selectedTeam,
  teamNames,
  onSelectTeam,
}: {
  teams: TeamAggregate[];
  selectedTeam: TeamAggregate | null;
  teamNames: Record<number, string>;
  onSelectTeam: (team: TeamAggregate) => void;
}) {
  const items = useMemo(
    () =>
      teams.map((t) => ({
        label: teamNames[t.team] || t.name ? `${t.team} - ${teamNames[t.team] || t.name}` : `Team ${t.team}`,
        value: t.team.toString(),
      })),
    [teams, teamNames]
  );

  return (
    <div>
      <label htmlFor="team-select" className={`mb-1.5 block ${labelClass}`}>Team</label>
      <NativeSelect
        id="team-select"
        value={selectedTeam ? selectedTeam.team.toString() : null}
        onChange={(val) => {
          const team = teams.find((t) => t.team.toString() === val);
          if (team) onSelectTeam(team);
        }}
        options={items}
        placeholder="Select a team"
      />
    </div>
  );
}

/* ============================================================================
 * MATCH SELECTOR
 * ==========================================================================*/

function MatchSelector({
  matches,
  selectedMatch,
  onSelectMatch,
}: {
  matches: MatchData[];
  selectedMatch: MatchData | null;
  onSelectMatch: (match: MatchData) => void;
}) {
  if (!matches || matches.length === 0) return null;

  const items = matches.map((m, idx) => ({
    label: `Match ${m.start?.match ?? idx + 1}${m.start?.practice ? ' (practice)' : ''}`,
    value: idx.toString(),
  }));

  const selectedIndex = selectedMatch ? matches.indexOf(selectedMatch) : -1;

  return (
    <div>
      <label htmlFor="match-select" className={`mb-1.5 block ${labelClass}`}>Match</label>
      <NativeSelect
        id="match-select"
        value={selectedIndex >= 0 ? selectedIndex.toString() : null}
        onChange={(val) => {
          const match = matches[parseInt(val, 10)];
          if (match) onSelectMatch(match);
        }}
        options={items}
        placeholder="Select a match"
      />
    </div>
  );
}

/* ============================================================================
 * MATCH DETAILS
 * ==========================================================================*/

function MatchDetails({ match }: { match: MatchData }) {
  const climb = match.teleop?.L3hang ? 'L3' : match.teleop?.L2hang ? 'L2' : match.teleop?.L1hang ? 'L1' : '-';

  return (
    <Section
      title={`Match ${match.start?.match ?? 'N/A'}`}
      icon={Flag}
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
          <dd className="mt-0.5 font-display text-3xl font-semibold leading-none text-ink">{match.teleop?.fuelscored ?? 0}</dd>
        </div>
        <div className="bg-surface px-4 py-3 sm:px-5">
          <dt className={`${labelClass} !text-endgame`}>Climb</dt>
          <dd className="mt-0.5 font-display text-3xl font-semibold leading-none text-ink">{climb}</dd>
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

/* ============================================================================
 * MATCH DATA TABLE
 * ==========================================================================*/

function RenderStatus({ success = 0, failure = 0 }: { success?: number; failure?: number }) {
  if (success > 0) return <Check className="mx-auto h-4 w-4 text-good" strokeWidth={3} aria-label="Succeeded" />;
  if (failure > 0) return <X className="mx-auto h-4 w-4 text-bad" strokeWidth={3} aria-label="Missed" />;
  return <span className="text-muted">-</span>;
}

function MatchDataTable({ matches }: { matches: MatchData[] }) {
  if (!matches || matches.length === 0) {
    return (
      <Section title="Match Performance Log" icon={ListOrdered}>
        <EmptyState icon={ClipboardList} title="No match data recorded yet.">
          Once a scout submits a match for this team it shows up here, live.
        </EmptyState>
      </Section>
    );
  }

  const thCls = 'px-2.5 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted whitespace-nowrap';
  const groupCls = 'px-2.5 pt-2.5 pb-1.5 text-center text-[11px] font-bold uppercase tracking-[0.08em] whitespace-nowrap border-t-[3px]';
  const tdCls = 'px-2.5 py-2.5 text-center whitespace-nowrap font-mono';

  return (
    <Section
      title="Match Performance Log"
      icon={ListOrdered}
      aside={<span className="font-mono text-xs font-medium text-muted">{matches.length} Matches</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-2">
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
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent-text">DEF</span>
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

/* ============================================================================
 * EXPERT SCOUT REPORT
 * ==========================================================================*/

function resolvePhotoUri(robotPhoto: PitData['robotPhoto']): string | null {
  if (!robotPhoto) return null;
  if (typeof robotPhoto === 'string') return robotPhoto;
  const base64 = robotPhoto.content ?? robotPhoto.data;
  const mime = robotPhoto.contentType ?? robotPhoto.content_type ?? 'image/jpeg';
  if (base64) {
    const clean = base64.replace(/^data:[^;]+;base64,/, '');
    return `data:${mime};base64,${clean}`;
  }
  return null;
}

function capitalizeSelector(value?: string): string | undefined {
  if (!value) return value;
  return value
    .split(/[\s/]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' / ');
}

const DEFENSE_LABELS: Record<number, string> = {
  1: 'Never practiced',
  2: 'Played once or twice',
  3: 'Decent, fine with either role',
  4: 'Strong, played several matches',
  5: 'Practiced & willing to dedicate',
};
const HP_LABELS: Record<number, string> = {
  1: 'No confidence / practice',
  2: 'Some practice, not confident',
  3: 'Moderate confidence',
  4: 'Confident & experienced',
  5: 'Extremely confident & practiced',
};

/** One group of the interview. `source` says whether the answer was asked or seen, which matters when trusting it. */
function ReportSection({ title, source, children }: { title: string; source?: 'Ask' | 'Interview' | 'Observed' | 'Legacy'; children: ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-4 first:border-t-0 sm:px-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {source && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${source === 'Observed' ? 'bg-teleop-soft text-teleop' : 'bg-surface-2 text-muted'}`}>
            {source}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function InfoBlock({ label, value, highlight, wide }: { label: string; value?: string; half?: boolean; highlight?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className={labelClass}>{label}</dt>
      <dd className={`mt-0.5 text-sm leading-6 ${!value ? 'text-muted' : highlight ? 'font-semibold text-accent-text' : 'text-ink'}`}>
        {value || 'N/A'}
      </dd>
    </div>
  );
}

function BadgeBlock({ label, value }: { label: string; value?: string; half?: boolean }) {
  const isYes = value?.toLowerCase() === 'yes';
  const isNo = value?.toLowerCase() === 'no';
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className={`mt-0.5 flex items-center gap-1.5 text-sm ${isYes ? 'font-semibold text-good' : isNo ? 'font-semibold text-bad' : 'text-muted'}`}>
        {isYes ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : isNo ? <X className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : null}
        {isYes ? 'Yes' : isNo ? 'No' : 'N/A'}
      </dd>
    </div>
  );
}

function RatingBlock({
  label,
  value,
  max,
  descriptions,
}: {
  label: string;
  value?: number;
  max: number;
  descriptions?: Record<number, string>;
}) {
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-1.5">
        <div className="flex gap-1" role="img" aria-label={value ? `${value} out of ${max}` : 'Not rated'}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <span
              key={n}
              className={`flex h-7 flex-1 items-center justify-center rounded text-xs font-bold ${
                value && n <= value ? (n === value ? 'bg-accent text-accent-ink' : 'bg-accent-soft text-accent-text') : 'bg-surface-2 text-muted'
              }`}
            >
              {n}
            </span>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{descriptions && value ? descriptions[value] : value ? `${value} of ${max}` : 'Not rated'}</p>
      </dd>
    </div>
  );
}

function ExpertScoutReport({ pitData, teamNumber }: { pitData?: PitData; teamNumber: number }) {
  if (!pitData) {
    return (
      <Section title="Expert Scout Report" icon={MessageSquareText}>
        <EmptyState icon={FileQuestion} title={`No pit interview for ${teamNumber} yet`}>
          Swing by their pit! The report appears here as soon as the interview is synced.
        </EmptyState>
      </Section>
    );
  }

  const photoUri = resolvePhotoUri(pitData.robotPhoto);

  return (
    <Section
      title="Expert Scout Report"
      icon={MessageSquareText}
      aside={pitData.scoutName ? <span className="text-xs text-muted">Interviewed by {pitData.scoutName}</span> : undefined}
    >
      <div className={photoUri ? 'grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}>
        {photoUri && (
          <div className="border-b border-line bg-surface-2 p-3 md:border-b-0 md:border-r">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUri} alt={`Team ${teamNumber} robot`} className="mx-auto h-64 w-full rounded-md object-contain" />
          </div>
        )}
        <ReportSection title="Drivetrain" source="Ask">
          <InfoBlock label="Drivetrain" value={capitalizeSelector(pitData.drivetrainType || pitData.driveBase)} />
          <InfoBlock label="Swerve Orientation" value={capitalizeSelector(pitData.swerveOrientation)} />
          <InfoBlock label="Drive Motors" value={capitalizeSelector(pitData.driveMotors)} />
          <InfoBlock label="Dimensions + Bumper" value={capitalizeSelector(pitData.drivetrainDimensions)} />
          <InfoBlock label="Weight (lbs)" value={pitData.robotWeight} />
          <InfoBlock label="Height (in)" value={pitData.robotHeight} />
        </ReportSection>
      </div>

      <div className="border-t border-line">
        <ReportSection title="Subsystems" source="Ask">
          <InfoBlock label="Top (Corral)" value={capitalizeSelector(pitData.openOrClosedTop)} />
          <BadgeBlock label="Functional Intake?" value={pitData.funcIntake} />
          <InfoBlock label="Type of Shooter" value={capitalizeSelector(pitData.typeOfShooter)} />
          <InfoBlock label="Type of Indexer" value={capitalizeSelector(pitData.typeOfIndexer)} />
          <InfoBlock label="Hopper Capacity" value={pitData.hopperCapacity?.toString()} />
        </ReportSection>

        <ReportSection title="Capabilities" source="Interview">
          <BadgeBlock label="Over Bump?" value={capitalizeSelector(pitData.canDriveOverBump)} />
          <BadgeBlock label="Under Trench?" value={capitalizeSelector(pitData.canGoUnderTrench)} />
          <InfoBlock label="Scoring Zones (Claimed)" value={capitalizeSelector(pitData.scoringZones)} />
          <InfoBlock label="Auton Start Position" value={capitalizeSelector(pitData.autonStartPosition)} />
          <InfoBlock label="Climb Capability" value={capitalizeSelector(pitData.climbCapability)} highlight />
          <BadgeBlock label="Can Pass Fuel?" value={capitalizeSelector(pitData.canPassFuel)} />
          <BadgeBlock label="Practiced Passing?" value={capitalizeSelector(pitData.hasPassedBefore)} />
        </ReportSection>

        <ReportSection title="Driver & Strategy" source="Interview">
          <RatingBlock
            label="Driver Years Exp (1-4)"
            value={pitData.driverYearsExperience || Number(pitData.driverExperience)}
            max={4}
          />
          <RatingBlock
            label="Defense Comfort (1-5)"
            value={pitData.defenseComfortDetailed || pitData.defenseComfort}
            max={5}
            descriptions={DEFENSE_LABELS}
          />
          <RatingBlock label="Human Player Confidence (1-5)" value={pitData.humanPlayerConfidence} max={5} descriptions={HP_LABELS} />
        </ReportSection>

        <ReportSection title="Getting to know them" source="Interview">
          <InfoBlock label="Favorite Part of Robot" value={capitalizeSelector(pitData.favoriteRobotPart)} />
          <InfoBlock label="Team Fun Fact" value={capitalizeSelector(pitData.teamFunFact)} />
          <InfoBlock label="Team Goals" value={capitalizeSelector(pitData.teamGoals)} wide />
          {pitData.hasRobotName && (
            <>
              <BadgeBlock label="Has Robot Name?" value={pitData.hasRobotName} />
              {pitData.hasRobotName.toLowerCase() === 'yes' && (
                <>
                  <InfoBlock label="Robot Name" value={pitData.robotName} />
                  <InfoBlock label="Name Origin" value={pitData.robotNameOrigin} />
                </>
              )}
            </>
          )}
        </ReportSection>

        <ReportSection title="Pit Scouter Observations" source="Observed">
          <BadgeBlock label="Zones Verified?" value={capitalizeSelector(pitData.scoringZonesVerified)} />
          <BadgeBlock label="Vision Verified?" value={capitalizeSelector(pitData.hasVisionTracking)} />
          <InfoBlock label="Scoring Aids Observed" value={capitalizeSelector(pitData.scoringAids)} />
          <BadgeBlock label="Scoring Aids Verified?" value={capitalizeSelector(pitData.scoringAidsVerified)} />
          <BadgeBlock label="Jank or Tippy?" value={capitalizeSelector(pitData.robotJankOrTippy)} />
          <InfoBlock label="Red Flags" value={capitalizeSelector(pitData.redFlags)} highlight={!!pitData.redFlags} />
          <InfoBlock label="Extra Comments" value={capitalizeSelector(pitData.extraComments)} wide />
        </ReportSection>

        {(pitData.qualStrategy || pitData.playoffStrategy || pitData.robotUnique || pitData.teamUnique || pitData.idealAlliance) && (
          <ReportSection title="Legacy Data" source="Legacy">
            {pitData.qualStrategy && <InfoBlock label="Qual Strategy" value={pitData.qualStrategy} />}
            {pitData.playoffStrategy && <InfoBlock label="Playoff Strategy" value={pitData.playoffStrategy} />}
            {pitData.robotUnique && <InfoBlock label="Robot Uniqueness" value={pitData.robotUnique} />}
            {pitData.teamUnique && <InfoBlock label="Team Uniqueness" value={pitData.teamUnique} />}
            {pitData.idealAlliance && <InfoBlock label="Dream Alliance" value={pitData.idealAlliance} highlight />}
          </ReportSection>
        )}
      </div>
    </Section>
  );
}

/* ============================================================================
 * CARD REPORTS TABLE
 * ==========================================================================*/

function CardReportsTable({ teamNumber }: { teamNumber: string | number }) {
  const teamKey = String(teamNumber);
  const [loaded, setLoaded] = useState<{ team: string; docs: Record<string, unknown>[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloads, setReloads] = useState(0);
  useRealtimeResync(() => setReloads((count) => count + 1));

  useEffect(() => {
    let isMounted = true;

    const loadCards = async () => {
      if (!teamNumber) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const allReports = await queryDashboardDocuments('reports', Number(teamNumber));
        if (isMounted) setLoaded({ team: String(teamNumber), docs: allReports.map(unwrapDoc) });
      } catch (error) {
        console.error('Error loading card reports:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadCards();
    return () => {
      isMounted = false;
    };
  }, [teamNumber, reloads]);

  const reportDocs = useRealtimeDocuments(loaded?.team === teamKey ? loaded.docs : NO_DOCS, new RegExp(`^report_(?:card_)?${teamKey}_`));
  const reports = useMemo(
    () => reportDocs.filter((doc) => docTeam(doc) === teamKey).map(toCardReport),
    [reportDocs, teamKey]
  );

  if (loading && !reports.length) {
    return <p className="px-5 py-8 text-center text-sm text-muted">Pulling card data…</p>;
  }

  if (!reports.length) {
    return (
      <EmptyState icon={ShieldCheck} title="No Card Reports">
        No card violations recorded for this team. Clean driving!
      </EmptyState>
    );
  }

  const thCls = 'px-4 py-2.5 text-left';
  const tdCls = 'px-4 py-3 text-sm text-ink';

  return (
    <div className="overflow-x-auto">
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th className={thCls}>Match</th>
            <th className={thCls}>Team</th>
            <th className={thCls}>Card</th>
            <th className={thCls}>Rule</th>
            <th className={thCls}>Notes</th>
            <th className={`${thCls} text-right`}>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.sourceId} className={rowClass}>
              <td className={`${tdCls} font-mono`}>{r.match}</td>
              <td className={`${tdCls} font-mono`}>{r.team}</td>
              <td className={`${tdCls} font-semibold`}>
                <span className="inline-flex items-center gap-2">
                  <span className={`h-4 w-3 rounded-[2px] ${r.cardType === 'Yellow' ? 'bg-[#f5c518]' : 'bg-alliance-red'}`} aria-hidden="true" />
                  {r.cardType}
                </span>
              </td>
              <td className={`${tdCls} font-mono`}>{r.ruleViolation}</td>
              <td className={tdCls}>{r.notes}</td>
              <td className={`${tdCls} text-right text-xs text-muted`}>
                {r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/A'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================================
 * AUTO PATH VISUALIZATION
 * ==========================================================================*/

// Path colour runs from the start of auto (teal) to the end (orange).
const PATH_START = [15, 118, 110];
const PATH_END = [194, 65, 12];

function AutoPathVisualization({
  match,
  canvasWidth = 520,
  canvasHeight = 355,
}: {
  match: MatchData;
  canvasWidth?: number;
  canvasHeight?: number;
}) {
  const markers = match?.auto?.markers || [];
  const alliance = match?.start?.alliance?.toLowerCase() || 'red';
  const shouldFlipImage = alliance === 'blue';
  const isFieldFlipped = Boolean(match?.auto?.fieldFlipped);
  const teamNumber = match?.teamNumber?.toString() || '';

  const markerColor = (type: 'pickup' | 'scoring') => (type === 'pickup' ? 'var(--teleop)' : 'var(--accent)');

  const PIXELS_PER_FOOT = canvasWidth / 27.135;
  const ROBOT_SIZE = 30;

  const [showViewer, setShowViewer] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [distance, setDistance] = useState(0);
  const [velocity, setVelocity] = useState('10');

  const cleanNumberInput = (text: string) => text.replace(/[^0-9.]/g, '');

  const { segments, totalDist } = useMemo(() => {
    const segs: {
      p1: { x: number; y: number };
      p2: { x: number; y: number };
      length: number;
      angle: number;
      startDist: number;
    }[] = [];
    let d = 0;
    const paths = match?.auto?.paths || [];

    paths.forEach((p) => {
      const matchesFound = [...p.matchAll(/([ML])\s*([\d.]+),([\d.]+)/gi)];
      let lastPt: { x: number; y: number } | null = null;
      matchesFound.forEach((m) => {
        const cmd = m[1].toUpperCase();
        const pt = { x: parseFloat(m[2]) * canvasWidth, y: parseFloat(m[3]) * canvasHeight };
        if (lastPt && cmd !== 'M') {
          const dx = pt.x - lastPt.x;
          const dy = pt.y - lastPt.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          segs.push({ p1: lastPt, p2: pt, length: len, angle, startDist: d });
          d += len;
        }
        lastPt = pt;
      });
    });
    return { segments: segs, totalDist: d };
  }, [match, canvasWidth, canvasHeight]);

  const interpolateColor = (ratio: number) => {
    const s = Math.max(0, Math.min(1, ratio));
    const [r, g, b] = PATH_START.map((from, i) => Math.round(from + (PATH_END[i] - from) * s));
    return `rgb(${r}, ${g}, ${b})`;
  };

  useEffect(() => {
    if (!isPlaying) return;
    let reqId: number;
    let lastTime = Date.now();
    const velocityFt = parseFloat(velocity) || 10;
    const velocityPx = velocityFt * PIXELS_PER_FOOT;

    const tick = () => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      setDistance((prev) => {
        const next = prev + velocityPx * dt;
        if (next >= totalDist) {
          setIsPlaying(false);
          return totalDist;
        }
        return next;
      });
      reqId = requestAnimationFrame(tick);
    };
    reqId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(reqId);
  }, [isPlaying, velocity, totalDist, PIXELS_PER_FOOT]);

  let robotX = -999;
  let robotY = -999;
  let robotAngle = 0;
  if (segments.length > 0) {
    const seg =
      segments.find((s) => distance >= s.startDist && distance <= s.startDist + s.length) ||
      segments[segments.length - 1];
    const ratio = seg.length === 0 ? 0 : Math.max(0, distance - seg.startDist) / seg.length;
    robotX = seg.p1.x + ratio * (seg.p2.x - seg.p1.x);
    robotY = seg.p1.y + ratio * (seg.p2.y - seg.p1.y);
    robotAngle = seg.angle;
  }

  const smallButton = 'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors';

  return (
    <Section
      title="Auto Path"
      icon={Route}
      aside={
        <button
          type="button"
          onClick={() => {
            if (showViewer) setIsPlaying(false);
            setShowViewer(!showViewer);
          }}
          className="text-sm font-medium text-accent-text hover:underline"
        >
          {showViewer ? 'Hide Auto Path Viewer' : 'Show Auto Path Viewer'}
        </button>
      }
    >
      <div className="p-4 sm:p-5">
        {showViewer && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              Speed
              <input
                className="h-9 w-16 rounded-md border border-line-strong bg-surface px-2 text-center font-mono text-sm text-ink outline-none focus:border-accent"
                value={velocity}
                onChange={(e) => setVelocity(cleanNumberInput(e.target.value))}
                inputMode="decimal"
              />
              ft/s
            </label>
            <div className="flex gap-2">
              {!isPlaying ? (
                <button
                  type="button"
                  onClick={() => {
                    if (distance >= totalDist && totalDist > 0) setDistance(0);
                    setIsPlaying(true);
                  }}
                  className={`${smallButton} border-accent bg-accent text-accent-ink hover:bg-accent-hover`}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Play
                </button>
              ) : (
                <button type="button" onClick={() => setIsPlaying(false)} className={`${smallButton} border-bad/40 text-bad hover:bg-bad-soft`}>
                  <Square className="h-4 w-4" aria-hidden="true" />
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDistance(0);
                  setIsPlaying(false);
                }}
                className={`${smallButton} border-line-strong text-ink hover:bg-surface-2`}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Restart
              </button>
            </div>
          </div>
        )}

        <div
          className="relative mx-auto w-full overflow-hidden rounded-md border border-line bg-surface-2"
          style={{ maxWidth: canvasWidth, aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `rotate(${isFieldFlipped ? 180 : 0}deg)`,
              transition: 'transform 420ms cubic-bezier(0.65, 0, 0.35, 1)',
            }}
          >
            {/* Place your field image at /public/field.png (matches the RN app's assets/images/field.png) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/field.png"
              alt="Field"
              style={{
                width: '200%',
                height: '100%',
                position: 'absolute',
                left: shouldFlipImage ? '-100%' : 0,
                top: 0,
                objectFit: 'cover',
              }}
            />
            <svg width={canvasWidth} height={canvasHeight} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {segments.map((seg, idx) => {
                const ratio = totalDist > 0 ? (seg.startDist + seg.length / 2) / totalDist : 0;
                return (
                  <line
                    key={`seg-${idx}`}
                    x1={seg.p1.x}
                    y1={seg.p1.y}
                    x2={seg.p2.x}
                    y2={seg.p2.y}
                    stroke={interpolateColor(ratio)}
                    strokeWidth={5}
                    strokeLinecap="round"
                  />
                );
              })}

              {markers.map((marker, idx) => {
                const mx = marker.x * canvasWidth;
                const my = marker.y * canvasHeight;
                return (
                  <g key={`marker-${idx}`}>
                    <circle cx={mx} cy={my} r={16} fill={markerColor(marker.type)} stroke="white" strokeWidth={2} />
                    <text x={mx} y={my + 5} fontSize={14} fontWeight="bold" fill="white" textAnchor="middle">
                      {marker.type === 'pickup' ? 'P' : 'S'}
                    </text>
                  </g>
                );
              })}

              {showViewer && segments.length > 0 && (
                <g transform={`translate(${robotX}, ${robotY}) rotate(${robotAngle})`}>
                  <rect
                    x={-ROBOT_SIZE / 2}
                    y={-ROBOT_SIZE / 2}
                    width={ROBOT_SIZE}
                    height={ROBOT_SIZE}
                    fill="rgb(23 25 28 / 0.8)"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    rx={4}
                  />
                  <rect x={ROBOT_SIZE / 2 - 4} y={-ROBOT_SIZE / 2} width={4} height={ROBOT_SIZE} fill="var(--accent)" rx={1} />
                  <text x={0} y={ROBOT_SIZE / 4 - 2} fontSize={Math.max(10, ROBOT_SIZE * 0.4)} fontWeight="bold" fill="white" textAnchor="middle">
                    {teamNumber}
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>

        <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teleop" />P = pickup</li>
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent" />S = scoring</li>
          <li className="flex items-center gap-1.5"><span className="h-1 w-6 rounded-full bg-gradient-to-r from-teleop to-accent" />path start → end</li>
        </ul>
      </div>
    </Section>
  );
}

/* ============================================================================
 * TEAM STAT SUMMARY (from the aggregate doc, shown above the match browser)
 * ==========================================================================*/

function TeamStatSummary({ team, nickname }: { team: TeamAggregate; nickname?: string }) {
  // Phase colours match the match log, so "auto" looks the same everywhere.
  const stats: { label: string; value: string | number; tone?: string }[] = [
    { label: 'Auto PPG', value: team.autoPpg.toFixed(1), tone: 'text-auto' },
    { label: 'Teleop PPG', value: team.teleopPpg.toFixed(1), tone: 'text-teleop' },
    { label: 'Endgame PPG', value: team.endgamePpg.toFixed(1), tone: 'text-endgame' },
    { label: 'Fuel / Match', value: team.fuelPerMatch.toFixed(1) },
    { label: 'Fuel Accuracy', value: `${team.fuelAccuracy}%` },
    { label: 'Defense', value: team.defenseRating.toFixed(1) },
    { label: 'Driver Skill', value: team.driverSkill.toFixed(1) },
    { label: 'Break Rate', value: `${team.breakRate}%`, tone: team.breakRate >= 25 ? 'text-bad' : undefined },
  ];
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-display text-5xl font-bold leading-none text-accent-text">{team.team}</span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">{nickname || team.name}</p>
            {nickname && nickname !== team.name && <p className="truncate text-xs text-muted">{team.name}</p>}
          </div>
        </div>
        <div className="flex gap-6">
          <div>
            <p className={labelClass}>Rank</p>
            <p className="font-display text-3xl font-semibold leading-none text-ink">{team.rank ? `#${team.rank}` : '-'}</p>
          </div>
          <div>
            <p className={labelClass}>Matches</p>
            <p className="font-display text-3xl font-semibold leading-none text-ink">{team.matches}</p>
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3 sm:px-5">
            <dt className={labelClass}>{s.label}</dt>
            <dd className={`mt-1 font-mono text-xl font-semibold ${s.tone ?? 'text-ink'}`}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ============================================================================
 * MAIN EXPORT
 * ==========================================================================*/

export default function TeamsClientView({ initialTeams, teamNames = {} }: TeamsClientViewProps) {
  const liveTeams = useAggregateRealtime(initialTeams);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(initialTeams[0]?.team ?? null);
  const selectedTeam = liveTeams.find((team) => team.team === selectedTeamId) ?? liveTeams[0] ?? null;
  const selectedTeamNumber = selectedTeam?.team;
  const [detail, setDetail] = useState<{ team: number; matches: Record<string, unknown>[]; pit: Record<string, unknown>[] } | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [reloads, setReloads] = useState(0);
  useRealtimeResync(() => setReloads((count) => count + 1));

  useEffect(() => {
    let isMounted = true;

    const loadTeamDetail = async () => {
      if (!selectedTeamNumber) return;
      setLoadingDetail(true);
      try {
        const [matchDocs, pitDocs] = await Promise.all([
          queryDashboardDocuments('matches', selectedTeamNumber),
          queryDashboardDocuments('pit', selectedTeamNumber),
        ]);

        if (matchDocs.length === 0) {
          console.warn(`[TeamsClientView] No "${MATCH_DOC_ID_PREFIX}${selectedTeamNumber}_*" docs found.`);
        }

        if (isMounted) setDetail({ team: selectedTeamNumber, matches: matchDocs.map(unwrapDoc), pit: pitDocs.map(unwrapDoc) });
      } catch (error) {
        console.error('Error loading team detail:', error);
        if (isMounted) setDetail({ team: selectedTeamNumber, matches: [], pit: [] });
      } finally {
        if (isMounted) setLoadingDetail(false);
      }
    };

    loadTeamDetail();
    return () => {
      isMounted = false;
    };
  }, [selectedTeamNumber, reloads]);

  // REST results for the selected team, with realtime creates, updates, and
  // deletes applied on top. Only the affected documents change.
  const loadedDetail = detail?.team === selectedTeamNumber ? detail : null;
  const matchDocs = useRealtimeDocuments(loadedDetail?.matches ?? NO_DOCS, new RegExp(`^${MATCH_DOC_ID_PREFIX}${selectedTeamNumber}_\\d+$`));
  const pitDocs = useRealtimeDocuments(loadedDetail?.pit ?? NO_DOCS, new RegExp(`^pit_${selectedTeamNumber}$`));
  const matches = useMemo(
    () => matchDocs
      .filter((doc) => docTeam(doc) === String(selectedTeamNumber))
      .map(toMatchData)
      .sort((a, b) => (a.start?.match ?? 0) - (b.start?.match ?? 0)),
    [matchDocs, selectedTeamNumber]
  );
  const teamPit = pitDocs.find((doc) => docTeam(doc) === String(selectedTeamNumber));
  const pitData = (teamPit?.data ?? teamPit) as PitData | undefined;
  const selectedMatch = matches.find((match) => match._id === selectedMatchId) ?? matches[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TeamSelector teams={liveTeams} selectedTeam={selectedTeam} teamNames={teamNames} onSelectTeam={(team) => { setSelectedTeamId(team.team); setSelectedMatchId(null); }} />
        <MatchSelector matches={matches} selectedMatch={selectedMatch} onSelectMatch={(match) => setSelectedMatchId(match._id ?? null)} />
      </div>

      {!selectedTeam ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface">
          <EmptyState icon={Bot} title="No teams available yet.">
            Teams appear once the first match of the event is scouted and synced.
          </EmptyState>
        </div>
      ) : (
        <>
          <TeamStatSummary team={selectedTeam} nickname={teamNames[selectedTeam.team]} />

          {loadingDetail && <p className="text-sm text-muted" role="status">Loading match data…</p>}

          {selectedMatch && (
            <div className="grid gap-5 xl:grid-cols-2">
              <MatchDetails match={selectedMatch} />
              <AutoPathVisualization match={selectedMatch} />
            </div>
          )}

          <MatchDataTable matches={matches} />

          <ExpertScoutReport pitData={pitData} teamNumber={selectedTeam.team} />

          <Section title="Card Reports" icon={RectangleVertical}>
            <CardReportsTable teamNumber={selectedTeam.team} />
          </Section>
        </>
      )}
    </div>
  );
}
