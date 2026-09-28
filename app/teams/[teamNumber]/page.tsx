import { notFound } from "next/navigation";
import { fetchTeamAggregatesSnapshot } from "@/services/couchbase";
import { RealtimeConnection } from "@/components/realtime/realtime-connection";
import { TeamDetailLive } from "@/components/teams/team-detail-live";

export default async function TeamDetailPage({ params }: { params: Promise<{ teamNumber: string }> }) {
  const { teamNumber } = await params;
  const teamId = Number(teamNumber);
  const { teams, lastSeq, names } = await fetchTeamAggregatesSnapshot();
  const team = teams.find((candidate) => candidate.team === teamId);
  if (!team) notFound();
  return <>
    <RealtimeConnection initialCursor={lastSeq} initialNames={names} />
    <TeamDetailLive team={team} />
  </>;
}
