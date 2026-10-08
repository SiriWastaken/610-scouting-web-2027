import { connection } from "next/server";
import type { ReactNode } from "react";
import { appConfig } from "@/app.config";
import { RealtimeConnection } from "@/components/dashboard/live-status";
import { AccessDenied, PageHeader } from "@/components/ui/kit";
import { requirePage } from "@/lib/auth/pages";
import { scoutingStore } from "@/services/scouting-store";

type Snapshot = Awaited<ReturnType<typeof scoutingStore.fetchTeamAggregatesSnapshot>>;
type Href = (typeof appConfig.navigation)[number]["href"];

/** The signed-in viewer's current snapshot, or null when they may not open dashboard pages. */
export async function loadLiveSnapshot(): Promise<Snapshot | null> {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return null;
  return scoutingStore.fetchTeamAggregatesSnapshot();
}

/**
 * A dashboard page: access check, a snapshot of the team rows, the page title and description from
 * `app.config.ts`, and the live-connection badge. `children` renders the body from the snapshot.
 */
export async function LivePage({ href, width, children }: { href: Href; width?: string; children: (snapshot: Snapshot) => ReactNode | Promise<ReactNode> }) {
  const snapshot = await loadLiveSnapshot();
  if (!snapshot) return <AccessDenied />;
  const page = appConfig.navigation.find((entry) => entry.href === href);
  return <div className={width ? `mx-auto ${width}` : undefined}>
    <PageHeader title={page?.label} description={page?.description} aside={<RealtimeConnection initialCursor={snapshot.lastSeq} initialNames={snapshot.names} />} />
    {await children(snapshot)}
  </div>;
}
