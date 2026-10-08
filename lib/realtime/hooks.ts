"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { mergeAggregates } from "@/lib/data/aggregates";
import { NO_DOCS, queryDashboardDocuments, unwrapDoc } from "@/lib/data/team-documents";
import { realtime } from "@/lib/realtime/client";
import type { TeamAggregate } from "@/types/scouting";

type Doc = Record<string, unknown>;

const subscribe = (listener: () => void) => realtime.subscribe(listener);
const getVersion = () => realtime.getVersion();
const getServerVersion = () => 0;

/** Re-renders the caller whenever the realtime feed records new information. */
function useRealtimeVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}

/** Server-rendered aggregates with realtime aggregate and team-name changes applied. */
export function useAggregateRealtime(initialTeams: TeamAggregate[]): TeamAggregate[] {
  const version = useRealtimeVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` signals store changes
  return useMemo(() => mergeAggregates(initialTeams, realtime.store, realtime.getSnapshotNames()), [initialTeams, version]);
}

/**
 * Documents loaded over REST, reconciled with the realtime feed: newer
 * revisions replace older ones, deletions remove them, and new documents whose
 * id matches `idPattern` are added.
 */
export function useRealtimeDocuments(documents: Doc[], idPattern: RegExp): Doc[] {
  const version = useRealtimeVersion();
  const source = idPattern.source;
  return useMemo(() => {
    const pattern = new RegExp(source);
    return realtime.store.merge(documents, (id) => pattern.test(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` signals store changes
  }, [documents, source, version]);
}

/** Runs `onResync` when the feed can no longer resume and REST data must be reloaded. */
export function useRealtimeResync(onResync: () => void) {
  const latest = useRef(onResync);
  useEffect(() => { latest.current = onResync; });
  useEffect(() => realtime.subscribeResync(() => latest.current()), []);
}

/**
 * One team's `kind` documents: loaded over REST (again after a resync), then kept
 * current from the realtime feed. Documents loaded for another team are never returned.
 */
export function useTeamDocuments(kind: "matches" | "pit" | "reports", team: number | undefined, idPattern: RegExp): { docs: Doc[]; loading: boolean } {
  const [loaded, setLoaded] = useState<{ team: number; docs: Doc[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloads, setReloads] = useState(0);
  useRealtimeResync(() => setReloads((count) => count + 1));

  useEffect(() => {
    if (!team) return;
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const docs = (await queryDashboardDocuments(kind, team)).map(unwrapDoc);
        if (isMounted) setLoaded({ team, docs });
      } catch (error) {
        console.error(`Error loading ${kind} documents:`, error);
        if (isMounted) setLoaded({ team, docs: [] });
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void load();
    return () => { isMounted = false; };
  }, [kind, team, reloads]);

  return { docs: useRealtimeDocuments(loaded && loaded.team === team ? loaded.docs : NO_DOCS, idPattern), loading };
}
