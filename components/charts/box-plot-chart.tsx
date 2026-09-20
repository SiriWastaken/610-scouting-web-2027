"use client";

import { useMemo, useState } from "react";
import type { TeamAggregate } from "@/types/scouting";

const metrics = [
  { key: "fuelPerMatch", label: "Fuel scored / match", suffix: "" },
  { key: "autoPpg", label: "Auto PPG", suffix: "" },
  { key: "teleopPpg", label: "Teleop PPG", suffix: "" },
  { key: "endgamePpg", label: "Endgame PPG", suffix: "" },
  { key: "fuelAccuracy", label: "Fuel accuracy", suffix: "%" },
  { key: "driverSkill", label: "Driver skill", suffix: " / 10" },
] as const;

export function BoxPlotChart({ teams }: { teams: TeamAggregate[] }) {
  const [metricKey, setMetricKey] = useState<(typeof metrics)[number]["key"]>("fuelPerMatch");
  const metric = metrics.find((candidate) => candidate.key === metricKey) ?? metrics[0];
  const values = useMemo(() => teams.map((team) => team[metric.key]).filter(Number.isFinite).sort((a, b) => a - b), [metric.key, teams]);

  if (values.length === 0) return <section className="border border-dashed border-[var(--line)] bg-[var(--panel)] p-8 text-sm text-[var(--muted)]">No aggregate data is available for this distribution yet.</section>;

  const min = values[0];
  const max = values[values.length - 1];
  const median = values[Math.floor((values.length - 1) / 2)];
  const lower = values[Math.floor((values.length - 1) / 4)];
  const upper = values[Math.floor((values.length - 1) * 0.75)];
  const position = (value: number) => max === min ? "50%" : `${((value - min) / (max - min)) * 100}%`;
  const format = (value: number) => `${value.toFixed(1)}${metric.suffix}`;

  return <section className="border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-7"><div className="flex flex-col gap-4 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">Metric</div><div className="mt-1 text-sm">{metric.label}</div></div><select value={metricKey} onChange={(event) => setMetricKey(event.target.value as typeof metricKey)} className="h-8 border border-[var(--line)] bg-[#0f1513] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--green-strong)]">{metrics.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
    <div className="mt-16 px-2"><div className="relative h-24 border-b border-[var(--line)]"><div className="absolute left-0 right-0 top-1/2 h-px bg-[#526258]" /><div className="absolute top-[calc(50%-1px)] h-0.5 bg-[var(--green)]" style={{ left: position(min), width: `calc(${position(max)} - ${position(min)})` }} /><div className="absolute top-[calc(50%-20px)] h-10 w-px bg-[var(--green)]" style={{ left: position(min) }} /><div className="absolute top-[calc(50%-20px)] h-10 w-px bg-[var(--green)]" style={{ left: position(max) }} /><div className="absolute top-1/2 h-12 -translate-y-1/2 border border-[var(--green)] bg-[#234c34]" style={{ left: position(lower), width: `calc(${position(upper)} - ${position(lower)})` }} /><div className="absolute top-1/2 h-14 w-px -translate-y-1/2 bg-white" style={{ left: position(median) }} /></div><div className="relative mt-3 h-5 font-mono text-[10px] text-[var(--muted)]"><span className="absolute left-0">{format(min)}</span><span className="absolute" style={{ left: position(median), transform: "translateX(-50%)" }}>{format(median)}</span><span className="absolute right-0">{format(max)}</span></div></div>
    <div className="mt-12 grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">{[["Min", min], ["Q1", lower], ["Median", median], ["Q3", upper]].map(([label, value]) => <div key={label} className="bg-[#101613] px-3 py-3"><div className="font-mono text-[10px] uppercase text-[var(--muted)]">{label}</div><div className="mt-1 font-mono text-sm text-[var(--foreground)]">{format(value as number)}</div></div>)}</div>
  </section>;
}