"use client";

import { useMemo, useState } from "react";
import { Activity, ArrowLeftRight, CircleAlert, Target } from "lucide-react";
import { buttonClass, EmptyState, NoteChip, rowClass, selectClass } from "@/components/ui/kit";
import type { TeamAggregate } from "@/types/scouting";
import { useAggregateRealtime } from "@/lib/realtime/hooks";
import { appConfig } from "@/app.config";
import {
  compareValues, DEFENSE_RATING_SCALE, DRIVER_SKILL_SCALE, fieldValues, formatMargin, formatMatches, formatPercent, formatPercentMargin, formatPoints, formatRating,
  isLowSample, isOutlier, LOW_SAMPLE_THRESHOLD, NO_DATA, OUTLIER_MEDIAN_MULTIPLE, OUTLIER_SD, statValue, totalPoints, type Leader, type StatKey,
} from "@/lib/data/team-stats";

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

interface Row { label: string; stat: StatKey | "total"; format: (value: number | null) => string; formatLead?: (margin: number) => string; phase?: Phase; total?: boolean }
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

const valueOf = (team: TeamAggregate, stat: StatKey | "total") => (stat === "total" ? totalPoints(team) : statValue(team, stat));
const optionLabel = (team: TeamAggregate) => `${team.team} / ${team.name}`;

const STAT_FIELDS = ["total", "autoPpg", "teleopPpg", "endgamePpg", "fuelAccuracy", "driverSkill", "defenseRating"] as const;
type Fields = Record<(typeof STAT_FIELDS)[number], number[]>;

/** Which teams are picked for the head-to-head and for each alliance. */
function useSelections(teams: TeamAggregate[]) {
  const [teamA, setTeamA] = useState(teams[0]?.team ?? 0);
  const [teamB, setTeamB] = useState(teams[1]?.team ?? teams[0]?.team ?? 0);
  const [red, setRed] = useState(() => Array.from({ length: ROBOTS_PER_ALLIANCE }, (_, index) => teams[index]?.team ?? 0));
  const [blue, setBlue] = useState(() => Array.from({ length: ROBOTS_PER_ALLIANCE }, (_, index) => teams[ROBOTS_PER_ALLIANCE + index]?.team ?? 0));
  return { teamA, setTeamA, teamB, setTeamB, red, setRed, blue, setBlue };
}

export function StrategyTools({ teams: initialTeams }: { teams: TeamAggregate[] }) {
  const teams = useAggregateRealtime(initialTeams);
  const { teamA, setTeamA, teamB, setTeamB, red, setRed, blue, setBlue } = useSelections(teams);
  // "Every team's value for this statistic", the field an outlier is judged against.
  const fields = useMemo(() => Object.fromEntries(STAT_FIELDS.map((stat) => [stat, fieldValues(teams, stat)])) as Fields, [teams]);

  if (teams.length === 0) return <div className="rounded-lg border border-dashed border-line-strong bg-surface"><EmptyState icon={Target} title="Nothing to strategize with yet">Strategy tools need averages from scouted matches. They fill in as soon as data syncs.</EmptyState></div>;

  const find = (number: number) => teams.find((team) => team.team === number);
  return <div className="space-y-5">
    <HeadToHead teams={teams} first={find(teamA) ?? teams[0]} second={find(teamB) ?? teams[0]} fields={fields} onFirst={setTeamA} onSecond={setTeamB} />
    <Prediction teams={teams} red={red} blue={blue} onRed={setRed} onBlue={setBlue} totals={fields.total} />
  </div>;
}

interface HeadToHeadProps { teams: TeamAggregate[]; first: TeamAggregate; second: TeamAggregate; fields: Fields; onFirst: (team: number) => void; onSecond: (team: number) => void }

function HeadToHead({ teams, first, second, fields, onFirst, onSecond }: HeadToHeadProps) {
  const canCompareOwn = teams.some((team) => team.team === OWN_TEAM) && first.team !== OWN_TEAM && second.team !== OWN_TEAM;
  return <section className="overflow-hidden rounded-lg border border-line bg-surface">
    <SectionHead title="Head to head" description="Two teams' averages side by side. The leader in each row is bold and shaded; the margin sits under it." />
    <div className="space-y-3 p-5">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <TeamSelect label="Team A" value={first.team} teams={teams} onChange={onFirst} />
        <button type="button" className={`${buttonClass} w-full sm:w-10 sm:px-0`} onClick={() => { onFirst(second.team); onSecond(first.team); }} aria-label="Swap Team A and Team B" title="Swap teams"><ArrowLeftRight className="h-4 w-4 rotate-90 sm:rotate-0" aria-hidden="true" /><span className="sm:hidden">Swap teams</span></button>
        <TeamSelect label="Team B" value={second.team} teams={teams} onChange={onSecond} />
      </div>
      <button type="button" className="h-8 rounded-md border border-line-strong px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canCompareOwn} onClick={() => onSecond(OWN_TEAM)} aria-label={`Compare Team A against team ${OWN_TEAM}`}>vs {OWN_TEAM}</button>
    </div>
    <div className="overflow-x-auto border-t border-line px-3 pb-4 sm:px-5">
      <table className="mx-auto w-full max-w-[38rem] table-fixed text-sm">
        <caption className="sr-only">{`${first.team} versus ${second.team}: average points, accuracy and ratings`}</caption>
        <colgroup><col /><col className="w-[7.5rem] sm:w-44" /><col /></colgroup>
        <thead><tr className="border-b border-line align-bottom"><TeamHead team={first} side="a" /><th scope="col" className="sr-only">Statistic</th><TeamHead team={second} side="b" /></tr></thead>
        {GROUPS.map((group) => <tbody key={group.title}>
          <tr><th scope="colgroup" colSpan={3} className={`px-2 pb-1.5 pt-4 text-center ${microLabel}`}>{group.title}</th></tr>
          {group.rows.map((row) => <CompareRow key={row.label} row={row} a={first} b={second} field={fields[row.stat]} />)}
        </tbody>)}
      </table>
    </div>
  </section>;
}

function TeamHead({ team, side }: { team: TeamAggregate; side: "a" | "b" }) {
  return <th scope="col" className={`px-2 pb-3 font-normal sm:px-3 ${side === "a" ? "text-right" : "text-left"}`}>
    <div className="break-words text-sm leading-5"><span className="font-mono font-semibold text-ink">{team.team}</span><span className="text-muted"> · </span><span className="font-medium text-ink-2">{team.name}</span></div>
    <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted ${side === "a" ? "justify-end" : "justify-start"}`}>
      <span>{formatMatches(team.matches)}</span>
      {isLowSample(team.matches) && <NoteChip icon={CircleAlert} title={LOW_SAMPLE_HINT}>Low sample</NoteChip>}
    </div>
  </th>;
}

function CompareRow({ row, a, b, field }: { row: Row; a: TeamAggregate; b: TeamAggregate; field: number[] }) {
  const left = valueOf(a, row.stat);
  const right = valueOf(b, row.stat);
  const { leader, margin } = compareValues(left, right);
  return <tr className={rowClass}>
    <ValueCell side="a" value={left} text={row.format(left)} leader={leader} margin={(row.formatLead ?? formatMargin)(margin)} outlier={left !== null && isOutlier(left, field)} big={row.total} />
    <td className="px-1 py-2.5 text-center align-middle">
      <div className={`${row.total ? "text-sm font-semibold" : "text-sm font-medium"} ${row.phase ? PHASE[row.phase].text : "text-ink-2"}`}>{row.label}</div>
      <SplitBar left={left} right={right} leader={leader} phase={row.phase} />
    </td>
    <ValueCell side="b" value={right} text={row.format(right)} leader={leader} margin={(row.formatLead ?? formatMargin)(margin)} outlier={right !== null && isOutlier(right, field)} big={row.total} />
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

interface PredictionProps { teams: TeamAggregate[]; red: number[]; blue: number[]; onRed: (slots: number[]) => void; onBlue: (slots: number[]) => void; totals: number[] }

function Prediction({ teams, red, blue, onRed, onBlue, totals }: PredictionProps) {
  const pick = (slots: number[]) => slots.map((number) => teams.find((team) => team.team === number));
  const redRobots = pick(red);
  const blueRobots = pick(blue);
  const redScore = allianceScore(redRobots);
  const blueScore = allianceScore(blueRobots);
  // One scale for every bar on the page, so a robot is the same length in either alliance.
  const biggest = Math.max(1, ...[...redRobots, ...blueRobots].map((team) => (team ? totalPoints(team) ?? 0 : 0)));
  const { leader, margin } = compareValues(redScore.robots ? redScore.total : null, blueScore.robots ? blueScore.total : null);
  const summary = leader === null ? "Pick robots for both alliances to compare them." : leader === "tie" ? "The alliances are even." : `${leader === "a" ? "Red" : "Blue"} alliance leads by ${margin.toFixed(1)} points.`;

  return <section className="overflow-hidden rounded-lg border border-line bg-surface">
    <SectionHead title="Match prediction" description="A transparent baseline: add up each alliance's average points in every phase, then compare the two totals." />
    <p className="border-b border-line px-5 py-3 text-sm font-medium text-ink" data-alliance-margin aria-live="polite">{summary}</p>
    <div className="grid gap-px bg-line lg:grid-cols-2">
      <Alliance name="Red" slug="red" robots={redRobots} slots={red} onSlots={onRed} teams={teams} score={redScore} biggest={biggest} totals={totals} />
      <Alliance name="Blue" slug="blue" robots={blueRobots} slots={blue} onSlots={onBlue} teams={teams} score={blueScore} biggest={biggest} totals={totals} />
    </div>
    <div className="space-y-2 border-t border-line px-5 py-3 text-xs leading-5 text-muted">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(["auto", "teleop", "endgame"] as const).map((phase) => <span key={phase} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${PHASE[phase].segment}`} />{phase === "auto" ? "Auto" : phase === "teleop" ? "Teleop" : "Endgame"}</span>)}
      </div>
      <p>Score = auto + teleop + endgame PPG, summed over the alliance&apos;s robots. A scouting baseline, not a match simulation. Robots with no data count as 0. Every bar uses one scale: full width is {biggest.toFixed(1)} points, the highest robot selected.</p>
    </div>
  </section>;
}

interface Score { total: number; robots: number }

/** Sums the selected robots' totals; a robot with no data adds 0. */
function allianceScore(robots: (TeamAggregate | undefined)[]): Score {
  const selected = robots.filter((team): team is TeamAggregate => Boolean(team));
  return { total: selected.reduce((sum, team) => sum + (totalPoints(team) ?? 0), 0), robots: selected.length };
}

/** Why an alliance score deserves caution: robots with no data, a low sample, or an outlier total. */
function confidenceReasons(robots: TeamAggregate[], totals: number[]): string[] {
  return robots.flatMap((team) => {
    const total = totalPoints(team);
    if (total === null) return [`${team.team}: no data`];
    const found = [];
    if (isLowSample(team.matches)) found.push(`${team.team}: ${formatMatches(team.matches).toLowerCase()}`);
    if (isOutlier(total, totals)) found.push(`${team.team}: outlier`);
    return found;
  });
}

function Alliance({ name, slug, robots, slots, onSlots, teams, score, biggest, totals }: { name: string; slug: string; robots: (TeamAggregate | undefined)[]; slots: number[]; onSlots: (slots: number[]) => void; teams: TeamAggregate[]; score: Score; biggest: number; totals: number[] }) {
  const selected = robots.filter((team): team is TeamAggregate => Boolean(team));
  const reasons = confidenceReasons(selected, totals);
  return <div className="bg-surface p-5" data-alliance={slug}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{name} alliance</h3>
        <div className={`mt-2 ${microLabel}`}>Estimated alliance score</div>
      </div>
      <div className="text-right">
        <div className="text-[44px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink" data-alliance-score={slug}>{score.robots ? score.total.toFixed(1) : NO_DATA}</div>
      </div>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
      <span>{selected.length ? `n = ${selected.map((team) => team.matches).join(", ")} matches` : "No robots selected"}</span>
      {reasons.length > 0 && <><NoteChip icon={CircleAlert} title="A selected robot has a low sample, an outlier total or no data, so treat this score with caution.">Low confidence</NoteChip><span>{reasons.join(" · ")}</span></>}
    </div>
    <ul className="mt-5 space-y-4" aria-label={`${name} alliance robots`}>
      {slots.map((slot, index) => <RobotSlot key={index} label={`Robot ${index + 1}`} value={robots[index] ? slot : 0} team={robots[index]} teams={teams} biggest={biggest} totals={totals} onChange={(value) => onSlots(slots.map((existing, at) => (at === index ? value : existing)))} />)}
    </ul>
  </div>;
}

function RobotSlot({ label, value, team, teams, biggest, totals, onChange }: { label: string; value: number; team?: TeamAggregate; teams: TeamAggregate[]; biggest: number; totals: number[]; onChange: (value: number) => void }) {
  const total = team ? totalPoints(team) : null;
  const parts = team && total !== null ? [["Auto", statValue(team, "autoPpg") ?? 0, PHASE.auto.segment], ["Teleop", statValue(team, "teleopPpg") ?? 0, PHASE.teleop.segment], ["Endgame", statValue(team, "endgamePpg") ?? 0, PHASE.endgame.segment]] as const : [];
  return <li>
    <label className="block"><span className={`mb-1.5 block ${microLabel}`}>{label}</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} className={selectClass}>
        <option value={0}>None</option>
        {teams.map((option) => <option key={option.team} value={option.team}>{optionLabel(option)}</option>)}
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
        <span>{formatMatches(team.matches)}</span>
        {isLowSample(team.matches) && <NoteChip icon={CircleAlert} title={LOW_SAMPLE_HINT}>Low sample</NoteChip>}
        {total !== null && isOutlier(total, totals) && <NoteChip icon={Activity} title={OUTLIER_HINT}>Outlier</NoteChip>}
      </div>
    </>}
  </li>;
}

function SectionHead({ title, description }: { title: string; description: string }) {
  return <div className="border-b border-line px-5 py-3.5"><h2 className="text-sm font-semibold text-ink">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div>;
}

function TeamSelect({ label, value, teams, onChange }: { label: string; value: number; teams: TeamAggregate[]; onChange: (value: number) => void }) {
  return <label className="block"><span className={`mb-1.5 block ${microLabel}`}>{label}</span><select value={value} onChange={(event) => onChange(Number(event.target.value))} className={selectClass}>{teams.map((team) => <option key={team.team} value={team.team}>{optionLabel(team)}</option>)}</select></label>;
}
