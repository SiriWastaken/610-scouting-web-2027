import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/ui/kit";
import { loadLiveSnapshot } from "@/components/dashboard/live-page";
import { RealtimeConnection } from "@/components/dashboard/live-status";
import { TeamDetailLive } from "@/components/dashboard/team-detail";

export default async function TeamDetailPage({ params }: { params: Promise<{ teamNumber: string }> }) {
  const snapshot = await loadLiveSnapshot();
  if (!snapshot) return <AccessDenied />;
  const teamId = Number((await params).teamNumber);
  const team = snapshot.teams.find((candidate) => candidate.team === teamId);
  if (!team) notFound();
  return <TeamDetailLive team={team} live={<RealtimeConnection initialCursor={snapshot.lastSeq} initialNames={snapshot.names} />} />;
}
