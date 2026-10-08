import { connection } from 'next/server';
import { requirePage } from '@/lib/auth/pages';
import { AccessDenied, PageHeader } from '@/components/ui/kit';
import { scoutingStore } from "@/services/scouting-store";
import { fetchTeamNickname } from '@/tba/blueAlliance';
import TeamsClientView from '@/components/dashboard/teams-view';
import { RealtimeConnection } from '@/components/dashboard/live-status';

export default async function TeamsPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  // 1. Team aggregates from Couchbase.
  const { teams: teamStats, lastSeq, names } = await scoutingStore.fetchTeamAggregatesSnapshot();

  // 2. Look up team nicknames on The Blue Alliance (server-side, so the API key stays private).
  const teamNames: Record<number, string> = {};
  await Promise.all(
    teamStats.map(async ({ team }) => {
      const nickname = await fetchTeamNickname(team);
      if (nickname) teamNames[team] = nickname;
    }),
  );

  return (
    <>
      <PageHeader
        title="Teams"
        description="Pick a team to see its averages, every scouted match, the pit interview, and any cards."
        aside={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />}
      />
      <TeamsClientView initialTeams={teamStats} teamNames={teamNames} />
    </>
  );
}
