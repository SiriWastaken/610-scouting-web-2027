import { connection } from "next/server";
import { requirePage } from "@/lib/auth/pages";
import { AccessDenied } from "@/components/ui/kit";
import { notFound } from "next/navigation";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/dashboard/live-status";
import { TeamDetailLive } from "@/components/dashboard/team-detail";

export default async function TeamDetailPage({ params }: { params: Promise<{ teamNumber: string }> }) {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  const { teamNumber } = await params;
  const teamId = Number(teamNumber);
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();
  const team = teams.find((candidate) => candidate.team === teamId);
  if (!team) notFound();
  return <TeamDetailLive team={team} live={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />} />;
}
