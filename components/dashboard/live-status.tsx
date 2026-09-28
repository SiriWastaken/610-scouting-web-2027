"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { realtime, type RealtimeStatus } from "@/lib/realtime/client";
import { useRealtimeResync } from "@/lib/realtime/hooks";

const statusLabel: Record<RealtimeStatus, string> = { disconnected: "Disconnected", connecting: "Connecting", connected: "Live updates on", reconnecting: "Reconnecting" };

export function RealtimeConnection({ initialCursor, initialNames }: { initialCursor: unknown; initialNames?: Record<string, string> }) {
  const router = useRouter();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [resyncs, setResyncs] = useState(0);
  const latestCursor = useRef(initialCursor);
  useEffect(() => { latestCursor.current = initialCursor; });

  useEffect(() => realtime.subscribeStatus(setStatus), []);
  useEffect(() => { realtime.connect(initialCursor); }, [initialCursor]);
  useEffect(() => { if (initialNames) realtime.setSnapshotNames(initialNames); }, [initialNames]);
  // After a resync the refreshed page normally brings a new cursor (handled
  // above). If it does not, retry with whatever cursor the page has; the client
  // applies its backoff so this cannot loop quickly.
  useEffect(() => {
    if (!resyncs) return;
    const timer = setTimeout(() => realtime.connect(latestCursor.current), 10_000);
    return () => clearTimeout(timer);
  }, [resyncs]);
  useEffect(() => {
    const online = () => realtime.retryNow();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  // The server could not resume from our cursor: fetch a fresh server snapshot
  // (and cursor) in place, without a full page reload.
  useRealtimeResync(() => {
    router.refresh();
    setResyncs((count) => count + 1);
  });

  return <div className="mb-5 flex items-center gap-2 border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-xs text-[var(--muted)]" aria-live="polite" data-realtime-status={status}><span className={`h-2 w-2 rounded-full ${status === "connected" ? "bg-[var(--green)]" : status === "reconnecting" ? "bg-amber-400" : "bg-[#64736a]"}`} />{statusLabel[status]}</div>;
}
