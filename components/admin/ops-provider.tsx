"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Overview } from "@/components/admin/types";

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
