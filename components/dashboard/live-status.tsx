"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { realtime, type RealtimeStatus } from "@/lib/realtime/client";
import { useRealtimeResync } from "@/lib/realtime/hooks";

const statusLabel: Record<RealtimeStatus, string> = { disconnected: "Disconnected", connecting: "Connecting", connected: "Live updates on", reconnecting: "Reconnecting" };

function useRetryWhenOnline() {
  useEffect(() => {
    const online = () => realtime.retryNow();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
}

/** Connects the browser's realtime client from the server-rendered cursor, and reconnects it when the feed needs a resync or the network returns. */
function useRealtimeConnection(initialCursor: unknown, initialNames?: Record<string, string>): RealtimeStatus {
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
  useRetryWhenOnline();
  // The server could not resume from our cursor: fetch a fresh server snapshot
  // (and cursor) in place, without a full page reload.
  useRealtimeResync(() => {
    router.refresh();
    setResyncs((count) => count + 1);
  });
  return status;
}

export function RealtimeConnection({ initialCursor, initialNames }: { initialCursor: unknown; initialNames?: Record<string, string> }) {
  const status = useRealtimeConnection(initialCursor, initialNames);
  const tone = status === "connected" ? "bg-good" : status === "reconnecting" ? "bg-warn" : "bg-muted";
  return <div className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-xs font-medium text-ink-2" aria-live="polite" data-realtime-status={status}>
    <span className="relative flex h-2 w-2">
      {status === "connected" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-40 [animation-duration:2.5s]" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
    </span>
    {statusLabel[status]}
  </div>;
}
