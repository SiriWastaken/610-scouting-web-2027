import type { ReactNode } from "react";

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
