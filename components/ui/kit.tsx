// Shared building blocks for every screen: panels and fields, button and input
// styles, status pills and stat tiles, empty and access-denied states, and
// date/duration formatting. Server-safe (no hooks), so pages and client
// components both use it.
import Link from "next/link";
import type { ReactNode } from "react";
import type { CheckStatus } from "@/services/health";

// ── from panel.tsx ────────────────────

/** The bordered section used across the app: a mono eyebrow header and a body. */
export function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden border border-[var(--line)] bg-[var(--panel)] ${className}`}>
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">{title}</h2>
      {action}
    </div>
    {children}
  </section>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1 border-t border-[var(--line)] px-5 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4">
    <dt className="w-40 shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</dt>
    <dd className="min-w-0 text-sm text-[var(--foreground)]">{children}</dd>
  </div>;
}

export const buttonClass = "inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-[var(--line)] px-3 text-sm text-[var(--foreground)] hover:border-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]";
export const primaryButtonClass = "inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-[var(--green)] bg-[var(--green)] px-3 text-sm font-medium text-[#0d1110] hover:bg-[#8fd0a5] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--green)]";
export const dangerButtonClass = "inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-red-400/50 px-3 text-sm text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400";
export const inputClass = "h-9 w-full rounded-sm border border-[var(--line)] bg-[#0f1412] px-3 text-sm text-[var(--foreground)] placeholder:text-[#58665e] focus:border-[var(--green)] focus:outline-none";

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

// ── from status.tsx ────────────────────

// Status always carries a symbol and a word, never color alone.
const STYLE: Record<CheckStatus, { symbol: string; label: string; text: string; ring: string }> = {
  ok: { symbol: "●", label: "Healthy", text: "text-[var(--green)]", ring: "border-[rgba(120,192,145,0.45)]" },
  degraded: { symbol: "▲", label: "Degraded", text: "text-amber-300", ring: "border-amber-400/50" },
  down: { symbol: "✕", label: "Down", text: "text-red-400", ring: "border-red-400/60" },
  idle: { symbol: "○", label: "Idle", text: "text-[var(--muted)]", ring: "border-[var(--line)]" },
  unknown: { symbol: "?", label: "Unknown", text: "text-amber-300", ring: "border-amber-400/40" },
  unconfigured: { symbol: "–", label: "Not configured", text: "text-[var(--muted)]", ring: "border-[var(--line)]" },
};

export function StatusPill({ status, label }: { status: CheckStatus; label?: string }) {
  const style = STYLE[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${style.text} ${style.ring}`} data-status={status}>
    <span aria-hidden="true">{style.symbol}</span>{label ?? style.label}
  </span>;
}

export function statusText(status: CheckStatus) { return STYLE[status].label; }

/** One number with its label, in the app's tile style. `tone` colours the number only for warnings. */
export function StatTile({ label, value, hint, tone = "normal" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "normal" | "warn" | "bad" | "good" }) {
  const color = tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-300" : tone === "good" ? "text-[var(--green)]" : "text-[var(--foreground)]";
  return <div className="bg-[var(--panel)] px-4 py-4">
    <div className={`font-mono text-xl tabular-nums ${color}`}>{value}</div>
    <div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--muted)]">{label}</div>
    {hint && <div className="mt-1 text-[11px] text-[#64736a]">{hint}</div>}
  </div>;
}

export function TileGrid({ children, columns = "sm:grid-cols-4" }: { children: ReactNode; columns?: string }) {
  return <div className={`grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)] ${columns}`}>{children}</div>;
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-[var(--muted)]">{children}</div>;
}

// ── from access-denied.tsx ────────────────────

/** Shown to a signed-in user whose role does not include a page. The server also refuses the page's APIs. */
export function AccessDenied({ title = "You don't have access to this page", message = "Your role doesn't include this area. If you need it, ask a mentor or your scout lead to change your role." }: { title?: string; message?: string }) {
  return <div className="mx-auto max-w-lg py-16 text-center">
    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">403 / RESTRICTED</div>
    <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{message}</p>
    <Link href="/teams" className="mt-6 inline-flex rounded-sm border border-[var(--line)] px-4 py-2 text-sm text-[var(--foreground)] hover:border-[var(--green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--green)]">Back to the dashboard</Link>
  </div>;
}
