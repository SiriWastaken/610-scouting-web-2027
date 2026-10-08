// The one file that describes THIS deployment: whose team it is, which pages exist, which averages are
// shown, how strict the analysis is, and which storage backend the scouting data is read from.
// Plain data only (no React, no icons, no env), so server code, client code and Node tests all import it.
// Secrets and connection settings stay in environment variables (.env.example); who may do what stays in
// lib/auth/roles.ts, because it is a security rule, not a preference. See docs/configuration.md.
import type { TeamAggregate } from "./types/scouting.ts";

/** Names a lucide icon; the sidebar maps each name to a component (components/layout/nav-links.tsx). */
export type NavIcon = "bot" | "sigma" | "target" | "chart" | "checklist" | "shield";

export interface NavEntry { href: string; label: string; icon: NavIcon; description: string }

/** Scouting-data backends. Adding one means implementing `ScoutingStore` and registering it in services/scouting-store.ts. */
export type ScoutingBackend = "syncGateway";

export interface AverageColumn {
  key: keyof TeamAggregate["rawData"];
  label: string;
  suffix?: string;
}

export const appConfig = {
  team: {
    number: 610,
    name: "Crescent Coyotes",
    season: "2026",
    game: "REBUILT",
    /** Browser-tab title and the wordmark beside the team number. */
    productName: "610 Scouting",
    description: "FRC Team 610 scouting and strategy workspace",
  },

  /** Main navigation, in order. `description` is the line under the page title. The Admin entry is added for accounts that can open it. */
  navigation: [
    { href: "/teams", label: "Teams", icon: "bot", description: "Pick a team to see its averages, every scouted match, the pit interview, and any cards." },
    { href: "/averages", label: "Averages", icon: "sigma", description: "Every team, every stat, averaged across the matches we have scouted. Tap a column heading to rank the board." },
    { href: "/strategy", label: "Strategy", icon: "target", description: "Line teams up against each other before a match. Everything here reads from the same averages as Teams." },
    { href: "/box-plot", label: "Box Plot", icon: "chart", description: "Compare the spread of a scouting statistic across the event. Tap a column heading to rank the board." },
    { href: "/coverage", label: "Coverage", icon: "checklist", description: "How complete our scouting is for this event, so the scout lead knows who still needs eyes on them." },
  ] as const satisfies ReadonlyArray<NavEntry>,
  adminNavigation: { href: "/admin", label: "Admin", icon: "shield" } as const satisfies Omit<NavEntry, "description">,

  /** How the Strategy and Teams pages judge the numbers. */
  analysis: {
    /** Rating scales, as the scouting form records them. */
    driverSkillScale: 10,
    defenseRatingScale: 5,
    /** A team with fewer scouted matches than this is flagged "low sample". */
    lowSampleThreshold: 3,
    /** A value is a likely outlier beyond this many standard deviations from the field mean... */
    outlierSd: 2.5,
    /** ...or beyond this multiple of the field median. */
    outlierMedianMultiple: 3,
    /** Fewer teams than this and neither rule says anything useful, so nothing is flagged. */
    outlierMinField: 5,
    robotsPerAlliance: 3,
  },

  /** Columns of the Averages table, left to right. `key` is a field of the aggregate document. */
  averagesColumns: [
    { key: "avgDefenseSkill", label: "Average defense skill", suffix: "/ 5" },
    { key: "breakSeverity", label: "Break severity" },
    { key: "bumpCrossed", label: "Bumps crossed" },
    { key: "fuelPlowed", label: "Fuel plowed / match" },
    { key: "fuelpassed", label: "Fuel passed / match" },
    { key: "fuelscored", label: "Fuel scored / match" },
    { key: "teleopFuelFed", label: "Teleop fuel fed" },
    { key: "trenchCrossed", label: "Trenches crossed" },
    { key: "L1accuracy", label: "L1 accuracy", suffix: "%" },
    { key: "L2accuracy", label: "L2 accuracy", suffix: "%" },
    { key: "L3accuracy", label: "L3 accuracy", suffix: "%" },
    { key: "aStopAvg", label: "Average A-stop" },
    { key: "autoFuelaccuracy", label: "Auto fuel accuracy", suffix: "%" },
    { key: "autoL1accuracy", label: "Auto L1 accuracy", suffix: "%" },
    { key: "autoPPG", label: "Auto PPG" },
    { key: "avgDriverSkill", label: "Average driver skill", suffix: "/ 10" },
    { key: "brokePercentage", label: "Broke percentage", suffix: "%" },
    { key: "endgamePPG", label: "Endgame PPG" },
    { key: "fuelfed", label: "Fuel fed" },
    { key: "matchesPlayed", label: "Matches played" },
    { key: "standing", label: "Standing" },
    { key: "teleopPPG", label: "Teleop PPG" },
    { key: "totalFuelPassed", label: "Total fuel passed" },
    { key: "totalFuelPlowed", label: "Total fuel plowed" },
    { key: "L1AverageHangTime", label: "L1 average hang time", suffix: "s" },
    { key: "L2AverageHangTime", label: "L2 average hang time", suffix: "s" },
    { key: "L3AverageHangTime", label: "L3 average hang time", suffix: "s" },
    { key: "playedDefenseMatches", label: "Played defense matches" },
    { key: "teleopFuelaccuracy", label: "Teleop fuel accuracy", suffix: "%" },
    { key: "weightedBrokePercentage", label: "Weighted broke percentage", suffix: "%" },
  ] satisfies AverageColumn[],

  storage: {
    scouting: "syncGateway" as ScoutingBackend,
    /** Pages render from a snapshot this old at most; the realtime feed fills the gap. */
    snapshotCacheMs: 20_000,
  },
};
