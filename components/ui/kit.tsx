// Shared building blocks for every screen: page headers, panels and fields, button and input
// styles, status pills and stat tiles, empty and access-denied states, and
// date/duration formatting. Server-safe (no hooks), so pages and client
// components both use it.
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, CircleCheck, CircleDashed, CircleHelp, CircleMinus, CircleX, Inbox, Lock, TriangleAlert, type LucideIcon } from "lucide-react";
import type { CheckStatus } from "@/services/health";

// ── Page layout and panels ──

/** Page title block: the title, one line of context, and an optional right-hand slot (live status, actions). */
export function PageHeader({ title, description, aside }: { title: ReactNode; description?: ReactNode; aside?: ReactNode }) {
  return <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.01em] text-ink">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm leading-[22px] text-muted">{description}</p>}
    </div>
    {aside && <div className="shrink-0">{aside}</div>}
  </header>;
}

/** Small label used above values and as field names. Sentence case, never uppercase. */
export const labelClass = "text-xs font-medium text-muted";

/** The bordered section used across the app: a header row with a title (and optional action) over a body. */
export function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-lg border border-line bg-surface ${className}`}>
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-5 py-3">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {action}
    </div>
    {children}
  </section>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1 border-t border-line px-5 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4">
    <dt className={`w-40 shrink-0 ${labelClass}`}>{label}</dt>
    <dd className="min-w-0 text-sm text-ink">{children}</dd>
  </div>;
}

const buttonBase = "inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const buttonClass = `${buttonBase} border-line-strong bg-raised text-ink hover:bg-surface-2`;
export const primaryButtonClass = `${buttonBase} border-accent bg-accent text-accent-foreground hover:border-accent-hover hover:bg-accent-hover`;
export const dangerButtonClass = `${buttonBase} border-bad/40 bg-surface text-bad hover:bg-bad-soft`;
export const inputClass = "h-10 w-full rounded-md border border-line-strong bg-raised px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
/** Native selects get the input look plus a drawn chevron, so they read as dropdowns on every platform. */
export const selectClass = `${inputClass} cursor-pointer appearance-none bg-[length:16px] bg-[position:right_0.6rem_center] bg-no-repeat pr-9 bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")]`;

/** Shared table styling so every data table in the app reads the same. */
export const tableClass = "w-full border-collapse text-left text-sm";
export const theadClass = "border-b border-line text-xs font-medium text-muted";
export const rowClass = "border-t border-line first:border-t-0 transition-colors hover:bg-surface-2/70";

export function formatDate(value: string | number | null | undefined, { relative = false }: { relative?: boolean } = {}) {
  if (value === null || value === undefined) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  if (relative) {
    const seconds = Math.round((Date.now() - date.getTime()) / 1000);
    const abs = Math.abs(seconds);
    const text = abs < 60 ? `${abs}s` : abs < 3600 ? `${Math.round(abs / 60)}m` : abs < 86400 ? `${Math.round(abs / 3600)}h` : `${Math.round(abs / 86400)}d`;
    return seconds >= 0 ? `${text} ago` : `in ${text}`;
  }
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

// ── Status pills ──

// Status always carries an icon and a word, never colour alone.
const STYLE: Record<CheckStatus, { icon: LucideIcon; label: string; className: string }> = {
  ok: { icon: CircleCheck, label: "Healthy", className: "bg-good-soft text-good" },
  degraded: { icon: TriangleAlert, label: "Degraded", className: "bg-warn-soft text-warn" },
  down: { icon: CircleX, label: "Down", className: "bg-bad-soft text-bad" },
  idle: { icon: CircleDashed, label: "Idle", className: "bg-surface-2 text-muted" },
  unknown: { icon: CircleHelp, label: "Unknown", className: "bg-warn-soft text-warn" },
  unconfigured: { icon: CircleMinus, label: "Not configured", className: "bg-surface-2 text-muted" },
};

export function StatusPill({ status, label }: { status: CheckStatus; label?: string }) {
  const style = STYLE[status];
  const Icon = style.icon;
  return <span className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold ${style.className}`} data-status={status}>
    <Icon className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2.25} />{label ?? style.label}
  </span>;
}

export function statusText(status: CheckStatus) { return STYLE[status].label; }

/** A small neutral note beside a value (icon + words, no hue): "Low sample", "Outlier". Never colour alone. */
export function NoteChip({ icon: Icon, children, title }: { icon: LucideIcon; children: ReactNode; title?: string }) {
  return <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-line-strong bg-surface-2 px-1.5 py-0.5 text-xs font-medium leading-4 text-ink-2">
    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" strokeWidth={2.25} />{children}
  </span>;
}

/** One number with its label. `tone` colours the number only when it means something (good / warn / bad). */
export function StatTile({ label, value, hint, tone = "normal" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "normal" | "warn" | "bad" | "good" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink";
  return <div className="bg-surface px-4 py-4">
    <div className={labelClass}>{label}</div>
    <div className={`mt-1.5 text-[22px] font-semibold leading-7 ${color}`} data-stat-value>{value}</div>
    {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
  </div>;
}

export function TileGrid({ children, columns = "sm:grid-cols-4" }: { children: ReactNode; columns?: string }) {
  return <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line ${columns}`}>{children}</div>;
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-muted">{children}</div>;
}

/** A friendly "nothing here yet" block with an icon, a headline, and a hint. */
export function EmptyState({ icon: Icon = Inbox, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return <div className="flex flex-col items-center px-6 py-10 text-center">
    <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted"><Icon className="h-5 w-5" aria-hidden="true" /></span>
    <p className="text-sm font-semibold text-ink">{title}</p>
    {children && <p className="mt-1 max-w-sm text-sm leading-6 text-muted">{children}</p>}
  </div>;
}

// ── Access denied ──

/** Shown to a signed-in user whose role does not include a page. The server also refuses the page's APIs. */
export function AccessDenied({ title = "You don't have access to this page", message = "Your role doesn't include this area. If you need it, ask a mentor or your scout lead to change your role." }: { title?: string; message?: string }) {
  return <div className="mx-auto max-w-lg py-16 text-center">
    <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn"><Lock className="h-5 w-5" aria-hidden="true" /></span>
    <div className="mb-2 text-xs font-medium text-warn">Restricted · 403</div>
    <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.01em]">{title}</h1>
    <p className="mt-3 text-sm leading-6 text-muted">{message}</p>
    <Link href="/teams" className={`mt-6 ${buttonClass}`}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to the dashboard</Link>
  </div>;
}
