// The Strategy page: a head-to-head comparison of two teams and a score prediction for two alliances. All
// reading of statistics goes through Team, Alliance and ScoutingEvent (lib/domain).
"use client";

import { useState } from "react";
import { Activity, ArrowLeftRight, CircleAlert, Target } from "lucide-react";
import { buttonClass, EmptyState, NoteChip, rowClass, selectClass } from "@/components/ui/kit";
import type { TeamAggregate } from "@/types/scouting";
import { useScoutingEvent } from "@/lib/realtime/hooks";
import { appConfig } from "@/app.config";
import {
  DEFENSE_RATING_SCALE, DRIVER_SKILL_SCALE, formatMargin, formatMatches, formatPercent, formatPercentMargin, formatPoints, formatRating,
  LOW_SAMPLE_THRESHOLD, NO_DATA, OUTLIER_MEDIAN_MULTIPLE, OUTLIER_SD, type Leader,
} from "@/lib/data/team-stats";
import type { Alliance } from "@/lib/domain/alliance";
import type { ScoutingEvent } from "@/lib/domain/scouting-event";
import type { StatName, Team } from "@/lib/domain/team";

/** Our own team: the "vs 610" shortcut compares against it. */
const OWN_TEAM = appConfig.team.number;
const ROBOTS_PER_ALLIANCE = appConfig.analysis.robotsPerAlliance;
/** Micro-labels are at least 12px (text-xs) everywhere on this page. */
const microLabel = "text-xs font-medium text-muted";
const OUTLIER_HINT = `Likely outlier: more than ${OUTLIER_SD} standard deviations from the field mean, or over ${OUTLIER_MEDIAN_MULTIPLE}× the field median.`;
const LOW_SAMPLE_HINT = `Fewer than ${LOW_SAMPLE_THRESHOLD} scouted matches, so this average is easily skewed.`;

type Phase = "auto" | "teleop" | "endgame";
/** Full class names so Tailwind can see them. `lead` is the solid bar, `trail` the dimmed one. */
const PHASE: Record<Phase, { text: string; lead: string; trail: string; tie: string; segment: string }> = {
  auto: { text: "text-auto", lead: "bg-auto", trail: "bg-auto/40", tie: "bg-auto/70", segment: "bg-auto" },
  teleop: { text: "text-teleop", lead: "bg-teleop", trail: "bg-teleop/40", tie: "bg-teleop/70", segment: "bg-teleop" },
  endgame: { text: "text-endgame", lead: "bg-endgame", trail: "bg-endgame/40", tie: "bg-endgame/70", segment: "bg-endgame" },
};
const NEUTRAL_BAR = { lead: "bg-ink-2", trail: "bg-ink-2/35", tie: "bg-ink-2/70" };

interface Row { label: string; stat: StatName; format: (value: number | null) => string; formatLead?: (margin: number) => string; phase?: Phase; total?: boolean }
const GROUPS: { title: string; rows: Row[] }[] = [
  { title: "Scoring", rows: [
    { label: "Total PPG", stat: "total", format: formatPoints, total: true },
    { label: "Auto PPG", stat: "autoPpg", format: formatPoints, phase: "auto" },
    { label: "Teleop PPG", stat: "teleopPpg", format: formatPoints, phase: "teleop" },
    { label: "Endgame PPG", stat: "endgamePpg", format: formatPoints, phase: "endgame" },
    { label: "Fuel accuracy", stat: "fuelAccuracy", format: formatPercent, formatLead: formatPercentMargin },
  ] },
  { title: "Ratings", rows: [
    { label: "Driver skill", stat: "driverSkill", format: (value) => formatRating(value, DRIVER_SKILL_SCALE) },
    { label: "Defense rating", stat: "defenseRating", format: (value) => formatRating(value, DEFENSE_RATING_SCALE) },
  ] },
];

const optionLabel = (team: Team) => `${team.number} / ${team.name}`;

/** Which teams are picked for the head-to-head and for each alliance. */
function useSelections(event: ScoutingEvent) {
  const numberAt = (index: number) => event.teams[index]?.number ?? 0;
  const [teamA, setTeamA] = useState(numberAt(0));
  const [teamB, setTeamB] = useState(event.teams[1]?.number ?? numberAt(0));
  const [red, setRed] = useState(() => Array.from({ length: ROBOTS_PER_ALLIANCE }, (_, index) => numberAt(index)));
  const [blue, setBlue] = useState(() => Array.from({ length: ROBOTS_PER_ALLIANCE }, (_, index) => numberAt(ROBOTS_PER_ALLIANCE + index)));
  return { teamA, setTeamA, teamB, setTeamB, red, setRed, blue, setBlue };
}

/** The Strategy page body. */
export function StrategyTools({ teams: initialTeams }: { teams: TeamAggregate[] }) {
  const event = useScoutingEvent(initialTeams);
  const { teamA, setTeamA, teamB, setTeamB, red, setRed, blue, setBlue } = useSelections(event);

  if (event.isEmpty) return <div className="rounded-lg border border-dashed border-line-strong bg-surface"><EmptyState icon={Target} title="Nothing to strategize with yet">Strategy tools need averages from scouted matches. They fill in as soon as data syncs.</EmptyState></div>;

  return <div className="space-y-5">
    <HeadToHead event={event} first={event.teamOrFirst(teamA)!} second={event.teamOrFirst(teamB)!} onFirst={setTeamA} onSecond={setTeamB} />
    <Prediction event={event} red={red} blue={blue} onRed={setRed} onBlue={setBlue} />
  </div>;
}

interface HeadToHeadProps { event: ScoutingEvent; first: Team; second: Team; onFirst: (team: number) => void; onSecond: (team: number) => void }

function HeadToHead({ event, first, second, onFirst, onSecond }: HeadToHeadProps) {
  const canCompareOwn = event.team(OWN_TEAM) !== undefined && first.number !== OWN_TEAM && second.number !== OWN_TEAM;
  return <section className="overflow-hidden rounded-lg border border-line bg-surface">
    <SectionHead title="Head to head" description="Two teams' averages side by side. The leader in each row is bold and shaded; the margin sits under it." />
    <div className="space-y-3 p-5">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <TeamSelect label="Team A" value={first.number} teams={event.teams} onChange={onFirst} />
        <button type="button" className={`${buttonClass} w-full sm:w-10 sm:px-0`} onClick={() => { onFirst(second.number); onSecond(first.number); }} aria-label="Swap Team A and Team B" title="Swap teams"><ArrowLeftRight className="h-4 w-4 rotate-90 sm:rotate-0" aria-hidden="true" /><span className="sm:hidden">Swap teams</span></button>
        <TeamSelect label="Team B" value={second.number} teams={event.teams} onChange={onSecond} />
      </div>
      <button type="button" className="h-8 rounded-md border border-line-strong px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canCompareOwn} onClick={() => onSecond(OWN_TEAM)} aria-label={`Compare Team A against team ${OWN_TEAM}`}>vs {OWN_TEAM}</button>
    </div>
    <div className="overflow-x-auto border-t border-line px-3 pb-4 sm:px-5">
      <table className="mx-auto w-full max-w-[38rem] table-fixed text-sm">
        <caption className="sr-only">{`${first.number} versus ${second.number}: average points, accuracy and ratings`}</caption>
        <colgroup><col /><col className="w-[7.5rem] sm:w-44" /><col /></colgroup>
        <thead><tr className="border-b border-line align-bottom"><TeamHead team={first} side="a" /><th scope="col" className="sr-only">Statistic</th><TeamHead team={second} side="b" /></tr></thead>
        {GROUPS.map((group) => <tbody key={group.title}>
          <tr><th scope="colgroup" colSpan={3} className={`px-2 pb-1.5 pt-4 text-center ${microLabel}`}>{group.title}</th></tr>
          {group.rows.map((row) => <CompareRow key={row.label} row={row} a={first} b={second} event={event} />)}
        </tbody>)}
      </table>
    </div>
  </section>;
}

function TeamHead({ team, side }: { team: Team; side: "a" | "b" }) {
  return <th scope="col" className={`px-2 pb-3 font-normal sm:px-3 ${side === "a" ? "text-right" : "text-left"}`}>
    <div className="break-words text-sm leading-5"><span className="font-mono font-semibold text-ink">{team.number}</span><span className="text-muted"> · </span><span className="font-medium text-ink-2">{team.name}</span></div>
    <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted ${side === "a" ? "justify-end" : "justify-start"}`}>
      <span>{formatMatches(team.matchesPlayed)}</span>
      {team.isLowSample() && <NoteChip icon={CircleAlert} title={LOW_SAMPLE_HINT}>Low sample</NoteChip>}
    </div>
  </th>;
}

function CompareRow({ row, a, b, event }: { row: Row; a: Team; b: Team; event: ScoutingEvent }) {
  const left = a.statValue(row.stat);
  const right = b.statValue(row.stat);
  const { leader, margin } = a.compareTo(b, row.stat);
  return <tr className={rowClass}>
    <ValueCell side="a" value={left} text={row.format(left)} leader={leader} margin={(row.formatLead ?? formatMargin)(margin)} outlier={event.isOutlier(a, row.stat)} big={row.total} />
    <td className="px-1 py-2.5 text-center align-middle">
      <div className={`${row.total ? "text-sm font-semibold" : "text-sm font-medium"} ${row.phase ? PHASE[row.phase].text : "text-ink-2"}`}>{row.label}</div>
      <SplitBar left={left} right={right} leader={leader} phase={row.phase} />
    </td>
    <ValueCell side="b" value={right} text={row.format(right)} leader={leader} margin={(row.formatLead ?? formatMargin)(margin)} outlier={event.isOutlier(b, row.stat)} big={row.total} />
  </tr>;
}

/** One team's value. The leader is brighter, heavier and shaded, and says so in text, so it reads in grayscale and to a screen reader. */
function ValueCell({ side, value, text, leader, margin, outlier, big }: { side: "a" | "b"; value: number | null; text: string; leader: Leader; margin: string; outlier: boolean; big?: boolean }) {
  const state = value === null ? "missing" : leader === "tie" ? "tie" : leader === side ? "lead" : leader ? "trail" : "plain";
  const tone = { missing: "text-muted", tie: "font-medium text-ink-2", lead: "font-bold text-ink bg-ink/[0.08]", trail: "font-normal text-muted", plain: "font-medium text-ink-2" }[state];
  const align = side === "a" ? "items-end text-right" : "items-start text-left";
  return <td className={`px-2 py-2.5 align-middle sm:px-3 ${tone}`} data-state={state}>
    <div className={`flex flex-col ${align}`}>
      <div className={`flex items-center gap-2 ${side === "a" ? "flex-row-reverse" : ""}`}>
        <span className={`tabular-nums ${big ? "text-[22px] font-semibold leading-7" : "text-base font-medium leading-6"}`} title={value === null ? "No scouted data" : undefined}>{text}</span>
        {outlier && <NoteChip icon={Activity} title={OUTLIER_HINT}>Outlier</NoteChip>}
      </div>
      <span className="min-h-4 text-xs font-medium leading-4 tabular-nums">{state === "lead" ? <><span className="sr-only">Leads by </span>{margin}</> : state === "tie" ? <><span aria-hidden="true">=</span><span className="sr-only">Tied</span></> : null}</span>
    </div>
  </td>;
}

/** A thin two-tone bar: each team's share of the pair. The leader's side is solid, the trailing side dimmed. */
function SplitBar({ left, right, leader, phase }: { left: number | null; right: number | null; leader: Leader; phase?: Phase }) {
  const colors = phase ? PHASE[phase] : NEUTRAL_BAR;
  const known = left !== null && right !== null;
  const sum = known ? left + right : 0;
  const share = known ? (sum > 0 ? (left / sum) * 100 : 50) : 0;
  const shade = (mine: "a" | "b") => (leader === "tie" ? colors.tie : leader === mine ? colors.lead : colors.trail);
  return <div aria-hidden="true" className="mx-auto mt-1.5 flex h-1.5 w-full max-w-[9rem] gap-px overflow-hidden rounded-full bg-line">
    {known && <><span className={shade("a")} style={{ width: `${share}%` }} /><span className={`flex-1 ${shade("b")}`} /></>}
  </div>;
}

interface PredictionProps { event: ScoutingEvent; red: number[]; blue: number[]; onRed: (slots: number[]) => void; onBlue: (slots: number[]) => void }

function Prediction({ event, red, blue, onRed, onBlue }: PredictionProps) {
  const redAlliance = event.alliance("red", red);
  const blueAlliance = event.alliance("blue", blue);
  const totals = event.fieldValues("total");
  // One scale for every bar on the page, so a robot is the same length in either alliance.
  const biggest = Math.max(1, ...[...redAlliance.robots, ...blueAlliance.robots].map((team) => team.totalPoints() ?? 0));
  const { leader, margin } = redAlliance.compareTo(blueAlliance);
  const summary = leader === null ? "Pick robots for both alliances to compare them." : leader === "tie" ? "The alliances are even." : `${leader === "a" ? "Red" : "Blue"} alliance leads by ${margin.toFixed(1)} points.`;

  return <section className="overflow-hidden rounded-lg border border-line bg-surface">
    <SectionHead title="Match prediction" description="A transparent baseline: add up each alliance's average points in every phase, then compare the two totals." />
    <p className="border-b border-line px-5 py-3 text-sm font-medium text-ink" data-alliance-margin aria-live="polite">{summary}</p>
    <div className="grid gap-px bg-line lg:grid-cols-2">
      <AllianceColumn name="Red" slug="red" alliance={redAlliance} slots={red} onSlots={onRed} event={event} biggest={biggest} totals={totals} />
      <AllianceColumn name="Blue" slug="blue" alliance={blueAlliance} slots={blue} onSlots={onBlue} event={event} biggest={biggest} totals={totals} />
    </div>
    <div className="space-y-2 border-t border-line px-5 py-3 text-xs leading-5 text-muted">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(["auto", "teleop", "endgame"] as const).map((phase) => <span key={phase} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${PHASE[phase].segment}`} />{phase === "auto" ? "Auto" : phase === "teleop" ? "Teleop" : "Endgame"}</span>)}
      </div>
      <p>Score = auto + teleop + endgame PPG, summed over the alliance&apos;s robots. A scouting baseline, not a match simulation. Robots with no data count as 0. Every bar uses one scale: full width is {biggest.toFixed(1)} points, the highest robot selected.</p>
    </div>
  </section>;
}

interface AllianceColumnProps { name: string; slug: string; alliance: Alliance; slots: number[]; onSlots: (slots: number[]) => void; event: ScoutingEvent; biggest: number; totals: number[] }

function AllianceColumn({ name, slug, alliance, slots, onSlots, event, biggest, totals }: AllianceColumnProps) {
  const reasons = alliance.confidenceReasons(totals);
  return <div className="bg-surface p-5" data-alliance={slug}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{name} alliance</h3>
        <div className={`mt-2 ${microLabel}`}>Estimated alliance score</div>
      </div>
      <div className="text-right">
        <div className="text-[44px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink" data-alliance-score={slug}>{alliance.isEmpty ? NO_DATA : alliance.score.toFixed(1)}</div>
      </div>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
      <span>{alliance.isEmpty ? "No robots selected" : `n = ${alliance.sampleSizes.join(", ")} matches`}</span>
      {reasons.length > 0 && <><NoteChip icon={CircleAlert} title="A selected robot has a low sample, an outlier total or no data, so treat this score with caution.">Low confidence</NoteChip><span>{reasons.join(" · ")}</span></>}
    </div>
    <ul className="mt-5 space-y-4" aria-label={`${name} alliance robots`}>
      {slots.map((slot, index) => {
        const team = event.team(slot);
        return <RobotSlot key={index} label={`Robot ${index + 1}`} value={team ? slot : 0} team={team} event={event} biggest={biggest} onChange={(value) => onSlots(slots.map((existing, at) => (at === index ? value : existing)))} />;
      })}
    </ul>
  </div>;
}

interface RobotSlotProps { label: string; value: number; team?: Team; event: ScoutingEvent; biggest: number; onChange: (value: number) => void }

function RobotSlot({ label, value, team, event, biggest, onChange }: RobotSlotProps) {
  const total = team?.totalPoints() ?? null;
  const parts = team && total !== null ? [["Auto", team.statValue("autoPpg") ?? 0, PHASE.auto.segment], ["Teleop", team.statValue("teleopPpg") ?? 0, PHASE.teleop.segment], ["Endgame", team.statValue("endgamePpg") ?? 0, PHASE.endgame.segment]] as const : [];
  return <li>
    <label className="block"><span className={`mb-1.5 block ${microLabel}`}>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={selectClass}>
        <option value={0}>None</option>
        {event.teams.map((option) => <option key={option.number} value={option.number}>{optionLabel(option)}</option>)}
      </select>
    </label>
    {team && <>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-3">
        <span className="flex h-3 gap-px overflow-hidden rounded-full bg-line-strong/50" role="img" aria-label={parts.length ? parts.map(([part, points]) => `${part} ${points.toFixed(1)}`).join(", ") : "No data"} title={parts.map(([part, points]) => `${part} ${points.toFixed(1)}`).join(" · ")}>
          {parts.map(([part, points, color]) => <span key={part} className={color} style={{ width: `${(points / biggest) * 100}%` }} />)}
        </span>
        <span className={`text-right font-mono text-sm tabular-nums ${total === null ? "text-muted" : "font-medium text-ink"}`}>{formatPoints(total)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>{formatMatches(team.matchesPlayed)}</span>
        {team.isLowSample() && <NoteChip icon={CircleAlert} title={LOW_SAMPLE_HINT}>Low sample</NoteChip>}
        {event.isOutlier(team, "total") && <NoteChip icon={Activity} title={OUTLIER_HINT}>Outlier</NoteChip>}
      </div>
    </>}
  </li>;
}

function SectionHead({ title, description }: { title: string; description: string }) {
  return <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-semibold text-ink">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>;
}

function TeamSelect({ label, value, teams, onChange }: { label: string; value: number; teams: readonly Team[]; onChange: (value: number) => void }) {
  return <label className="block"><span className={`mb-1.5 block ${microLabel}`}>{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))} className={selectClass}>{teams.map((team) => <option key={team.number} value={team.number}>{optionLabel(team)}</option>)}</select></label>;
}
