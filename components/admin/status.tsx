import type { ReactNode } from "react";
import type { CheckStatus } from "@/components/admin/types";

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
