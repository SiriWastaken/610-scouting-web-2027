'use client';

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { TeamAggregate } from '@/types/scouting';
import { useAggregateRealtime, useRealtimeDocuments, useRealtimeResync } from '@/lib/use-realtime';

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
  const data = (doc.data ?? doc) as MatchData;
  // Fill in the match number from the doc id (`scouting_<team>_<match>`) if it
  // isn't already in the data. Documents may be shared with the realtime store,
  // so build a copy rather than mutating them.
  const { match: matchNum } = parseScoutingId(doc._id);
  const start = data.start?.match === undefined && matchNum ? { ...data.start, match: Number(matchNum) } : data.start;
  return { ...data, start, _id: typeof doc._id === 'string' ? doc._id : undefined };
}

function toCardReport(doc: Record<string, unknown>): CardReport {
  const data = (doc.data ?? {}) as Record<string, unknown>;
  return {
    sourceId: String(doc._id ?? ''),
    match: (doc.match as string | number) ?? (data.matchNumber as string | number) ?? 'N/A',
    team: (doc.team as string | number) ?? (data.teamNumber as string | number) ?? 'N/A',
    cardType: (data.cardType as string) ?? 'Unknown',
    ruleViolation: (data.ruleViolation as string) ?? 'N/A',
    notes: (data.notes as string) ?? 'None',
    timestamp: (doc.timestamp as string) ?? (data.timestamp as string),
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
 * SHARED ICONS (inline SVG, no extra dependency)
 * ==========================================================================*/

const Icon = {
  check: (props: { size?: number; color?: string }) => (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill={props.color ?? 'var(--green)'} />
      <path d="M7 12.5l3 3 7-7" stroke="var(--panel)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (props: { size?: number; color?: string }) => (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill={props.color ?? '#e05252'} />
      <path d="M8 8l8 8M16 8l-8 8" stroke="var(--panel)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  ban: (props: { size?: number; color?: string }) => (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={props.color ?? 'var(--muted)'} strokeWidth="2" />
      <path d="M6 6l12 12" stroke={props.color ?? 'var(--muted)'} strokeWidth="2" />
    </svg>
  ),
  chat: (props: { size?: number; color?: string }) => (
    <svg width={props.size ?? 20} height={props.size ?? 20} viewBox="0 0 24 24" fill="none">
      <path
        d="M21 12a8 8 0 01-11.6 7.1L4 20l1.2-4.3A8 8 0 1121 12z"
        stroke={props.color ?? 'var(--green)'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  ),
  eye: (props: { size?: number; color?: string }) => (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke={props.color ?? '#e0a458'} strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke={props.color ?? '#e0a458'} strokeWidth="1.8" />
    </svg>
  ),
  doc: (props: { size?: number; color?: string }) => (
    <svg width={props.size ?? 40} height={props.size ?? 40} viewBox="0 0 24 24" fill="none">
      <path
        d="M7 3h7l4 4v14a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"
        stroke={props.color ?? 'var(--muted)'}
        strokeWidth="1.5"
      />
      <path d="M9 12h6M9 16h6M9 8h2" stroke={props.color ?? 'var(--muted)'} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

/* ============================================================================
 * SMALL SHARED UI PRIMITIVES
 * ==========================================================================*/

function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`bg-[var(--panel)] rounded-2xl border border-[var(--line)] ${className}`} style={style}>
      {children}
    </div>
  );
}

function NativeSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[var(--panel-raised)] text-[var(--foreground)] rounded-lg px-3 py-3 border border-[var(--line)] outline-none focus:border-[var(--green)] transition-colors appearance-none"
    >
      <option value="" disabled className="text-[var(--muted)]">
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
    <div className="mb-4">
      <p className="text-[var(--foreground)] text-sm font-semibold mb-2">Select Team</p>
      <NativeSelect
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
    <div className="mb-4">
      <p className="text-[var(--foreground)] text-sm font-semibold mb-2">Select Match</p>
      <NativeSelect
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
  const alliance = match.start?.alliance;
  const badgeBg = alliance === 'blue' ? 'bg-blue-500' : alliance === 'red' ? 'bg-red-500' : 'bg-[var(--panel-raised)]';
  const climb = match.teleop?.L3hang ? 'L3' : match.teleop?.L2hang ? 'L2' : match.teleop?.L1hang ? 'L1' : '-';

  return (
    <Card className="p-5 mb-6">
      <div className="flex justify-between items-center mb-3">
        <p className="text-[var(--foreground)] text-lg font-bold">Match {match.start?.match ?? 'N/A'}</p>
        <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${badgeBg}`}>
          {alliance?.toUpperCase() ?? 'UNK'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex-1 min-w-[100px] bg-[var(--panel-raised)] p-2 rounded-lg">
          <p className="text-[var(--muted)] text-xs">Scout</p>
          <p className="text-[var(--foreground)] text-sm font-semibold">{match.start?.scoutName || 'Unknown'}</p>
        </div>
        <div className="flex-1 min-w-[100px] bg-[var(--panel-raised)] p-2 rounded-lg">
          <p className="text-[var(--muted)] text-xs">Position</p>
          <p className="text-[var(--foreground)] text-sm font-semibold">
            {match.start?.position?.toUpperCase() || 'Unknown'}
          </p>
        </div>
        <div className="flex-1 min-w-[100px] p-2 rounded-lg" style={{ background: 'rgba(120,192,145,0.12)' }}>
          <p className="text-[var(--green)] text-xs">Fuel</p>
          <p className="text-[var(--green)] text-lg font-bold font-mono">{match.teleop?.fuelscored ?? 0}</p>
        </div>
        <div className="flex-1 min-w-[100px] bg-purple-500/10 p-2 rounded-lg">
          <p className="text-purple-300 text-xs">Climb</p>
          <p className="text-purple-300 text-lg font-bold font-mono">{climb}</p>
        </div>
      </div>

      {match.teleop?.general && (
        <div className="bg-[var(--panel-raised)] p-3 rounded-lg border border-[var(--line)]">
          <p className="text-[var(--muted)] text-xs font-semibold mb-1">Match Notes</p>
          <p className="text-[var(--foreground)] text-sm leading-5">{match.teleop.general}</p>
        </div>
      )}
    </Card>
  );
}

/* ============================================================================
 * MATCH DATA TABLE
 * ==========================================================================*/

function RenderStatus({ success = 0, failure = 0 }: { success?: number; failure?: number }) {
  if (success > 0) return <Icon.check size={16} />;
  if (failure > 0) return <Icon.x size={16} />;
  return <span className="text-[var(--muted)]">-</span>;
}

function MatchDataTable({ matches }: { matches: MatchData[] }) {
  if (!matches || matches.length === 0) {
    return (
      <Card className="p-5 mt-8 mb-6 items-center">
        <p className="text-[var(--muted)] text-center font-medium">No match data recorded yet.</p>
      </Card>
    );
  }

  const thCls = 'px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] whitespace-nowrap';
  const tdCls = 'px-3 py-2 text-center whitespace-nowrap';

  return (
    <Card className="overflow-hidden mt-8 mb-6">
      <div className="px-5 py-3 border-b border-[var(--line)] flex justify-between items-center">
        <p className="text-[var(--foreground)] text-lg font-bold">Match Performance Log</p>
        <span className="bg-[var(--green-strong)] px-3 py-1 rounded-full text-white text-xs font-bold">
          {matches.length} Matches
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--panel-raised)] border-b border-[var(--line)]">
              <th className={thCls} rowSpan={2}>
                Match
              </th>
              <th className={`${thCls} text-blue-400`} colSpan={2}>
                Autonomous
              </th>
              <th className={`${thCls} text-[var(--green)]`} colSpan={4}>
                Teleop
              </th>
              <th className={`${thCls} text-purple-300`} colSpan={4}>
                Endgame
              </th>
              <th className={thCls} colSpan={3}>
                Status
              </th>
            </tr>
            <tr className="bg-[var(--panel-raised)] border-b border-[var(--line)]">
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
                <tr
                  key={idx}
                  className={`border-b border-[var(--line)] ${idx % 2 === 1 ? 'bg-[var(--panel-raised)]/40' : ''}`}
                >
                  <td className={`${tdCls} text-left font-bold text-[var(--foreground)]`}>
                    <span
                      className={`inline-block w-1.5 h-4 rounded mr-2 align-middle ${
                        isBlue ? 'bg-blue-500' : 'bg-red-500'
                      }`}
                    />
                    {start.match ?? '-'}
                  </td>
                  <td className={`${tdCls} text-blue-300 font-medium`}>{auto.fuelScored ?? 0}</td>
                  <td className={`${tdCls} text-[var(--muted)]`}>{auto.fuelFed ?? 0}</td>
                  <td className={`${tdCls} text-[var(--green)] font-bold`}>{tele.fuelscored ?? 0}</td>
                  <td className={`${tdCls} text-[var(--muted)]`}>{tele.fuelpassed ?? 0}</td>
                  <td className={`${tdCls} text-sky-300`}>{tele.teleopFuelFed ?? 0}</td>
                  <td className={`${tdCls} text-orange-300`}>{tele.fuelPlowed ?? 0}</td>
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
                    {!attemptedClimb ? <Icon.ban size={16} /> : <span className="text-[var(--muted)]">-</span>}
                  </td>
                  <td className={tdCls}>
                    {tele.playedDefense ? (
                      <span className="bg-blue-500/15 text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-500/40">
                        DEF
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">-</span>
                    )}
                  </td>
                  <td className={tdCls}>
                    {tele.breakDuration ? (
                      <span className="text-orange-300 font-bold text-xs">{tele.breakDuration}s</span>
                    ) : (
                      <span className="text-[var(--muted)]">-</span>
                    )}
                  </td>
                  <td className={`${tdCls} text-[var(--muted)] text-[11px]`}>{tele.breakSeverity || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
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

function ReportSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-3 border-b border-[var(--line)] pb-2">
        {icon}
        <p className="text-[var(--green)] text-sm font-bold uppercase tracking-wide">{title}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function InfoBlock({ label, value, half, highlight }: { label: string; value?: string; half?: boolean; highlight?: boolean }) {
  return (
    <div className={half ? 'w-[48%]' : 'w-full'}>
      <p className="text-[var(--muted)] text-xs font-bold uppercase mb-1 ml-1">{label}</p>
      <div
        className={`p-3 rounded-xl border text-sm font-medium leading-5 ${
          highlight ? 'border-[var(--green)]/30 text-[var(--green)]' : 'border-[var(--line)] text-[var(--foreground)]'
        }`}
        style={{ background: highlight ? 'rgba(120,192,145,0.08)' : 'var(--panel-raised)' }}
      >
        {value || 'N/A'}
      </div>
    </div>
  );
}

function BadgeBlock({ label, value, half }: { label: string; value?: string; half?: boolean }) {
  const isYes = value?.toLowerCase() === 'yes';
  const isNo = value?.toLowerCase() === 'no';
  return (
    <div className={half ? 'w-[48%]' : 'w-full'}>
      <p className="text-[var(--muted)] text-xs font-bold uppercase mb-1 ml-1">{label}</p>
      <div
        className={`p-3 rounded-xl border text-sm font-bold ${
          isYes
            ? 'bg-[var(--green)]/10 border-[var(--green)]/30 text-[var(--green)]'
            : isNo
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'border-[var(--line)] text-[var(--muted)]'
        }`}
        style={!isYes && !isNo ? { background: 'var(--panel-raised)' } : undefined}
      >
        {isYes ? '✓ Yes' : isNo ? '✗ No' : 'N/A'}
      </div>
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
      <p className="text-[var(--muted)] text-xs font-bold uppercase mb-1 ml-1">{label}</p>
      <div className="bg-[var(--panel-raised)] p-3 rounded-xl border border-[var(--line)]">
        <div className="flex gap-1 mb-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={`flex-1 py-1 rounded text-center text-xs font-bold ${
                value === n ? 'text-[var(--panel)]' : 'text-[var(--muted)] bg-[var(--panel)]/60'
              }`}
              style={value === n ? { background: 'var(--green)' } : undefined}
            >
              {n}
            </div>
          ))}
        </div>
        {descriptions && value ? (
          <p className="text-[var(--muted)] text-xs italic mt-1">{descriptions[value]}</p>
        ) : (
          <p className="text-[var(--muted)] text-xs italic">Not rated</p>
        )}
      </div>
    </div>
  );
}

function ExpertScoutReport({ pitData, teamNumber }: { pitData?: PitData; teamNumber: number }) {
  if (!pitData) {
    return (
      <Card className="p-6 border-dashed items-center mt-6 mb-8 text-center">
        <Icon.doc />
        <p className="text-[var(--muted)] italic mt-2">No Expert Scout Interview recorded for Team {teamNumber}</p>
      </Card>
    );
  }

  const photoUri = resolvePhotoUri(pitData.robotPhoto);

  return (
    <Card className="overflow-hidden mt-6 mb-8" style={{ borderColor: 'rgba(120,192,145,0.3)' }}>
      <div className="p-4 border-b flex items-center gap-2" style={{ background: 'rgba(120,192,145,0.08)', borderColor: 'rgba(120,192,145,0.2)' }}>
        <Icon.chat size={20} />
        <p className="text-[var(--green)] text-lg font-bold uppercase tracking-wider">Expert Scout Report</p>
      </div>

      <div className="p-5">
        <div className="mb-6 flex flex-wrap items-start gap-4">
          {photoUri && (
            <div className="flex-[0.42] min-w-[220px]">
              <div className="rounded-2xl border border-white/10 bg-black/30 overflow-hidden p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUri} alt={`Team ${teamNumber} robot`} className="w-full h-64 object-contain mx-auto" />
              </div>
            </div>
          )}

          <div className="min-w-[240px]" style={{ flex: photoUri ? 0.58 : 1 }}>
            <ReportSection icon={<span className="w-4 h-4 rounded-sm bg-blue-400" />} title="Drivetrain — Ask">
              <div className="flex flex-wrap justify-between gap-y-3">
                <InfoBlock label="Drivetrain" value={capitalizeSelector(pitData.drivetrainType || pitData.driveBase)} half />
                <InfoBlock label="Swerve Orientation" value={capitalizeSelector(pitData.swerveOrientation)} half />
                <InfoBlock label="Drive Motors" value={capitalizeSelector(pitData.driveMotors)} half />
                <InfoBlock label="Dimensions + Bumper" value={capitalizeSelector(pitData.drivetrainDimensions)} half />
                <InfoBlock label="Weight (lbs)" value={pitData.robotWeight} half />
                <InfoBlock label="Height (in)" value={pitData.robotHeight} half />
              </div>
            </ReportSection>
          </div>
        </div>

        <ReportSection icon={<span className="w-4 h-4 rounded-sm bg-blue-400" />} title="Subsystems - Ask">
          <div className="flex flex-wrap justify-between gap-y-3">
            <InfoBlock label="Top (Corral)" value={capitalizeSelector(pitData.openOrClosedTop)} half />
            <BadgeBlock label="Functional Intake?" value={pitData.funcIntake} half />
            <InfoBlock label="Type of Shooter" value={capitalizeSelector(pitData.typeOfShooter)} half />
            <InfoBlock label="Type of Indexer" value={capitalizeSelector(pitData.typeOfIndexer)} half />
          </div>
          <InfoBlock label="Hopper Capacity" value={pitData.hopperCapacity?.toString()} />
        </ReportSection>

        <ReportSection icon={<span className="w-4 h-4 rounded-sm bg-blue-400" />} title="Capabilities - Interview">
          <div className="flex flex-wrap justify-between gap-y-3">
            <BadgeBlock label="Over Bump?" value={capitalizeSelector(pitData.canDriveOverBump)} half />
            <BadgeBlock label="Under Trench?" value={capitalizeSelector(pitData.canGoUnderTrench)} half />
          </div>
          <InfoBlock label="Scoring Zones (Claimed)" value={capitalizeSelector(pitData.scoringZones)} />
          <InfoBlock label="Auton Start Position" value={capitalizeSelector(pitData.autonStartPosition)} />
          <InfoBlock label="Climb Capability" value={capitalizeSelector(pitData.climbCapability)} highlight />
          <div className="flex flex-wrap justify-between gap-y-3">
            <BadgeBlock label="Can Pass Fuel?" value={capitalizeSelector(pitData.canPassFuel)} half />
            <BadgeBlock label="Practiced Passing?" value={capitalizeSelector(pitData.hasPassedBefore)} half />
          </div>
        </ReportSection>

        <ReportSection icon={<span className="w-4 h-4 rounded-sm bg-blue-400" />} title="Driver & Strategy - Interview">
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

        <ReportSection icon={<span className="w-4 h-4 rounded-sm bg-purple-400" />} title="Qualitative - Interview">
          <InfoBlock label="Favorite Part of Robot" value={capitalizeSelector(pitData.favoriteRobotPart)} />
          <InfoBlock label="Team Fun Fact" value={capitalizeSelector(pitData.teamFunFact)} />
          <InfoBlock label="Team Goals" value={capitalizeSelector(pitData.teamGoals)} />
          {pitData.hasRobotName && (
            <>
              <BadgeBlock label="Has Robot Name?" value={pitData.hasRobotName} />
              {pitData.hasRobotName.toLowerCase() === 'yes' && (
                <div className="flex flex-wrap justify-between gap-y-3">
                  <InfoBlock label="Robot Name" value={pitData.robotName} half />
                  <InfoBlock label="Name Origin" value={pitData.robotNameOrigin} half />
                </div>
              )}
            </>
          )}
        </ReportSection>

        <ReportSection icon={<Icon.eye size={18} />} title="Pit Scouter Observations">
          <div className="flex flex-wrap justify-between gap-y-3">
            <BadgeBlock label="Zones Verified?" value={capitalizeSelector(pitData.scoringZonesVerified)} half />
            <BadgeBlock label="Vision Verified?" value={capitalizeSelector(pitData.hasVisionTracking)} half />
          </div>
          <InfoBlock label="Scoring Aids Observed" value={capitalizeSelector(pitData.scoringAids)} />
          <BadgeBlock label="Scoring Aids Verified?" value={capitalizeSelector(pitData.scoringAidsVerified)} />
          <BadgeBlock label="Jank or Tippy?" value={capitalizeSelector(pitData.robotJankOrTippy)} />
          <InfoBlock label="Red Flags" value={capitalizeSelector(pitData.redFlags)} highlight={!!pitData.redFlags} />
          <InfoBlock label="Extra Comments" value={capitalizeSelector(pitData.extraComments)} />
        </ReportSection>

        {(pitData.qualStrategy || pitData.playoffStrategy || pitData.robotUnique || pitData.teamUnique || pitData.idealAlliance) && (
          <ReportSection icon={<span className="w-4 h-4 rounded-sm bg-[var(--muted)]" />} title="Legacy Data">
            {pitData.qualStrategy && <InfoBlock label="Qual Strategy" value={pitData.qualStrategy} />}
            {pitData.playoffStrategy && <InfoBlock label="Playoff Strategy" value={pitData.playoffStrategy} />}
            {pitData.robotUnique && <InfoBlock label="Robot Uniqueness" value={pitData.robotUnique} />}
            {pitData.teamUnique && <InfoBlock label="Team Uniqueness" value={pitData.teamUnique} />}
            {pitData.idealAlliance && <InfoBlock label="Dream Alliance" value={pitData.idealAlliance} highlight />}
          </ReportSection>
        )}

        {pitData.scoutName && (
          <div className="mt-6 pt-4 border-t border-[var(--line)] flex justify-end">
            <p className="text-[var(--muted)] text-xs italic">Interviewed by {pitData.scoutName}</p>
          </div>
        )}
      </div>
    </Card>
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
    return (
      <Card className="p-6 items-center mt-2 text-center">
        <p className="text-yellow-400 text-xs uppercase tracking-widest">Pulling Card Data...</p>
      </Card>
    );
  }

  if (!reports.length) {
    return (
      <Card className="p-6 border-dashed items-center mt-2 text-center">
        <p className="text-[var(--foreground)] font-bold">No Card Reports</p>
        <p className="text-[var(--muted)] text-xs mt-1">No card violations recorded for this team.</p>
      </Card>
    );
  }

  const thCls = 'px-3 py-2 text-center text-xs font-bold text-[var(--muted)]';
  const tdCls = 'px-3 py-3 text-center text-sm text-[var(--foreground)]';

  return (
    <Card className="overflow-hidden mt-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--line)]">
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
              <tr key={r.sourceId} className="border-b border-[var(--line)] last:border-b-0">
                <td className={tdCls}>{r.match}</td>
                <td className={tdCls}>{r.team}</td>
                <td className={`${tdCls} font-bold ${r.cardType === 'Yellow' ? 'text-yellow-400' : 'text-red-400'}`}>
                  {r.cardType}
                </td>
                <td className={tdCls}>{r.ruleViolation}</td>
                <td className={tdCls}>{r.notes}</td>
                <td className={`${tdCls} text-right text-[var(--muted)] text-xs`}>
                  {r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ============================================================================
 * AUTO PATH VISUALIZATION
 * ==========================================================================*/

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

  const BLUE = '#0066B3';
  const RED = '#ED1C24';
  const markerColor = (type: 'pickup' | 'scoring') => (type === 'pickup' ? BLUE : RED);

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
    const r = Math.round(0 + (237 - 0) * s);
    const g = Math.round(102 + (28 - 102) * s);
    const b = Math.round(179 + (36 - 179) * s);
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

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[var(--foreground)] text-lg font-bold">Auto Path</p>
        <button
          onClick={() => {
            if (showViewer) setIsPlaying(false);
            setShowViewer(!showViewer);
          }}
          className="bg-[var(--panel-raised)] hover:bg-[var(--line)] transition-colors px-3 py-1.5 rounded text-sm font-bold text-[var(--foreground)]"
        >
          {showViewer ? 'Hide Auto Path Viewer' : 'Show Auto Path Viewer'}
        </button>
      </div>

      {showViewer && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted)] text-sm">Vel (ft/s):</span>
            <input
              className="bg-[var(--panel-raised)] text-[var(--foreground)] px-2 py-1 rounded w-16 text-center text-sm border border-[var(--line)] outline-none focus:border-[var(--green)]"
              value={velocity}
              onChange={(e) => setVelocity(cleanNumberInput(e.target.value))}
              inputMode="decimal"
            />
          </div>

          <div className="flex gap-2">
            {!isPlaying ? (
              <button
                onClick={() => {
                  if (distance >= totalDist && totalDist > 0) setDistance(0);
                  setIsPlaying(true);
                }}
                className="text-white font-bold text-sm px-3 py-1.5 rounded"
                style={{ background: 'var(--green-strong)' }}
              >
                Play
              </button>
            ) : (
              <button onClick={() => setIsPlaying(false)} className="bg-red-600 text-white font-bold text-sm px-3 py-1.5 rounded">
                Stop
              </button>
            )}
            <button
              onClick={() => {
                setDistance(0);
                setIsPlaying(false);
              }}
              className="bg-blue-600 text-white font-bold text-sm px-3 py-1.5 rounded"
            >
              Restart
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          width: '100%',
          maxWidth: canvasWidth,
          aspectRatio: `${canvasWidth} / ${canvasHeight}`,
          background: 'var(--panel-raised)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          margin: '0 auto',
        }}
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
                  <circle cx={mx} cy={my} r={18} fill={markerColor(marker.type)} stroke="white" strokeWidth={2} />
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
                  fill="rgba(0,0,0,0.6)"
                  stroke="var(--green)"
                  strokeWidth={2}
                  rx={4}
                />
                <rect x={ROBOT_SIZE / 2 - 4} y={-ROBOT_SIZE / 2} width={4} height={ROBOT_SIZE} fill="var(--green)" rx={1} />
                <text x={0} y={ROBOT_SIZE / 4 - 2} fontSize={Math.max(10, ROBOT_SIZE * 0.4)} fontWeight="bold" fill="white" textAnchor="middle">
                  {teamNumber}
                </text>
              </g>
            )}
          </svg>
        </div>
      </div>
    </Card>
  );
}

/* ============================================================================
 * TEAM STAT SUMMARY (from the aggregate doc, shown above the match browser)
 * ==========================================================================*/

function TeamStatSummary({ team }: { team: TeamAggregate }) {
  const stats: { label: string; value: string | number }[] = [
    { label: 'Rank', value: team.rank || '-' },
    { label: 'Matches', value: team.matches },
    { label: 'Auto PPG', value: team.autoPpg.toFixed(1) },
    { label: 'Teleop PPG', value: team.teleopPpg.toFixed(1) },
    { label: 'Endgame PPG', value: team.endgamePpg.toFixed(1) },
    { label: 'Fuel / Match', value: team.fuelPerMatch.toFixed(1) },
    { label: 'Fuel Accuracy', value: `${team.fuelAccuracy}%` },
    { label: 'Defense', value: team.defenseRating.toFixed(1) },
    { label: 'Driver Skill', value: team.driverSkill.toFixed(1) },
    { label: 'Break Rate', value: `${team.breakRate}%` },
  ];

  return (
    <Card className="p-5 mb-6">
      <p className="text-[var(--foreground)] text-lg font-bold mb-4">{team.name}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-[var(--panel-raised)] rounded-lg p-3">
            <p className="text-[var(--muted)] text-[11px] uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-[var(--foreground)] text-lg font-bold font-mono">{s.value}</p>
          </div>
        ))}
      </div>
    </Card>
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
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
        <TeamSelector teams={liveTeams} selectedTeam={selectedTeam} teamNames={teamNames} onSelectTeam={(team) => { setSelectedTeamId(team.team); setSelectedMatchId(null); }} />
        <MatchSelector matches={matches} selectedMatch={selectedMatch} onSelectMatch={(match) => setSelectedMatchId(match._id ?? null)} />
      </div>

      {!selectedTeam ? (
        <Card className="p-6 text-center">
          <p className="text-[var(--muted)]">No teams available yet.</p>
        </Card>
      ) : (
        <>
          <TeamStatSummary team={selectedTeam} />

          {loadingDetail && (
            <p className="text-[var(--muted)] text-sm mb-4">Loading match data…</p>
          )}

          {selectedMatch && (
            <>
              <MatchDetails match={selectedMatch} />
              <AutoPathVisualization match={selectedMatch} />
            </>
          )}

          <MatchDataTable matches={matches} />

          <ExpertScoutReport pitData={pitData} teamNumber={selectedTeam.team} />

          <div className="mb-8">
            <p className="text-[var(--foreground)] text-lg font-bold mb-2">Card Reports</p>
            <CardReportsTable teamNumber={selectedTeam.team} />
          </div>
        </>
      )}
    </div>
  );
}
