"use client";

// What every admin tab shares: the overview data (one request every 15 s for
// the whole admin area, via OpsProvider/useOps), its types, the tab bar, the
// "updated … ago / Refresh" bar, and a clock for relative times.
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useSession } from "@/components/auth/session";
import { formatDate } from "@/components/ui/kit";
import { ADMIN_SECTIONS } from "@/lib/auth/roles";
import type { MetricsSnapshot } from "@/lib/ops/metrics";
import type { Check, CheckStatus, serverInfo } from "@/services/health";
import type { snapshotStatus } from "@/services/couchbase";

export type { Check, CheckStatus };

// ── from types.ts ────────────────────

export type CheckName = "api" | "syncGateway" | "couchbase" | "accountStore" | "realtime" | "auth" | "persistence";

/** GET /api/admin/overview (and POST /api/admin/diagnostics, which adds `persistence`). */
export interface Overview {
  server: ReturnType<typeof serverInfo>;
  overall: CheckStatus;
  checkedAt: number;
  checks: Partial<Record<CheckName, Check>> & Record<Exclude<CheckName, "persistence">, Check>;
  snapshot: ReturnType<typeof snapshotStatus>;
  metrics: MetricsSnapshot;
}

// ── from ops-provider.tsx ────────────────────

interface OpsContextValue {
  data: Overview | null;
  error: string | null;
  loading: boolean;
  /** When the browser last received a fresh overview. */
  updatedAt: number | null;
  /** Round trip of the last overview request, measured by this browser. */
  clientLatencyMs: number | null;
  refresh: () => Promise<void>;
  /** Replaces the data with a fresher result (e.g. from a diagnostics run). */
  replace: (overview: Overview) => void;
}

const OpsContext = createContext<OpsContextValue | null>(null);
export const POLL_MS = 15_000;

/**
 * One overview request for the whole admin area, every 15 s while the tab is
 * visible, shared by every tab and card. The server caches its upstream checks
 * for 10 s, so several admins watching at once cost Sync Gateway nothing extra.
 */
export function OpsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [clientLatencyMs, setClientLatencyMs] = useState<number | null>(null);
  const inFlight = useRef(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    const started = performance.now();
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      setClientLatencyMs(Math.round(performance.now() - started));
      if (response.status === 401) { router.replace(`/welcome?reason=expired&next=${encodeURIComponent(window.location.pathname)}`); return; }
      const body = await response.json().catch(() => null) as (Overview & { message?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.message ?? `The API answered HTTP ${response.status}`);
      setData(body); setError(null); setUpdatedAt(Date.now());
    } catch (reason) {
      setClientLatencyMs(null);
      setError(reason instanceof Error && reason.message !== "Failed to fetch" ? reason.message : "The API did not answer. The server may be down or unreachable from this device.");
    } finally { inFlight.current = false; setLoading(false); }
  }, [enabled, router]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, refresh]);

  const replace = useCallback((overview: Overview) => { setData(overview); setError(null); setUpdatedAt(Date.now()); }, []);
  const value = useMemo(() => ({ data, error, loading, updatedAt, clientLatencyMs, refresh, replace }), [data, error, loading, updatedAt, clientLatencyMs, refresh, replace]);
  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
}

export function useOps(): OpsContextValue {
  const value = useContext(OpsContext);
  if (!value) throw new Error("useOps must be used inside OpsProvider");
  return value;
}

// ── from admin-tabs.tsx ────────────────────

export function AdminTabs() {
  const pathname = usePathname();
  const { session } = useSession();
  const sections = ADMIN_SECTIONS.filter((section) => session.permissions[section.permission]);
  return <nav aria-label="Admin sections" className="mb-7 flex gap-1 overflow-x-auto border-b border-line">
    {sections.map((section) => {
      const active = section.href === "/admin" ? pathname === "/admin" : pathname.startsWith(section.href);
      return <Link key={section.href} href={section.href} aria-current={active ? "page" : undefined}
        className={`-mb-px flex min-h-11 min-w-max items-center border-b-2 px-3 text-sm font-medium transition-colors ${active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}>{section.label}</Link>;
    })}
  </nav>;
}

/** "Updated 5s ago · Refresh" with the error, if the last poll failed. */
export function FreshnessBar() {
  const { updatedAt, error, refresh, loading } = useOps();
  return <div className="flex flex-wrap items-center gap-3 text-xs text-muted" aria-live="polite">
    {error ? <span className="inline-flex items-center gap-1.5 text-bad" data-ops-error><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{error}</span> : updatedAt ? <span>Updated {formatDate(updatedAt, { relative: true })} · refreshes every 15 s</span> : loading ? <span>Loading…</span> : null}
    <button type="button" onClick={() => void refresh()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 font-medium text-ink hover:bg-surface-2"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Refresh</button>
  </div>;
}

// ── from use-now.ts ────────────────────

/** The current time, updated every `intervalMs`, so render stays pure while "5s ago" labels keep moving. */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
