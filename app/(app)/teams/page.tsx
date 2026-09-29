// app/teams/page.tsx
import { connection } from 'next/server';
import { requirePage } from '@/lib/auth/pages';
import { Bot } from 'lucide-react';
import { AccessDenied, PageHeader } from '@/components/ui/kit';
import { fetchTeamAggregatesSnapshot } from '@/services/couchbase';
import TeamsClientView from '@/components/dashboard/teams-view';
import { RealtimeConnection } from '@/components/dashboard/live-status';

export default async function TeamsPage() {
  // Live data: render per request even when the build had no Couchbase settings.
  await connection();
  if (!(await requirePage("dashboard:read")).allowed) return <AccessDenied />;
  // 1. Fetch team aggregates from Couchbase (Server-side)
  const { teams: teamStats, lastSeq, names } = await fetchTeamAggregatesSnapshot();

  // 2. Fetch team nicknames from The Blue Alliance securely on the server
  const teamNames: Record<number, string> = {};
  const tbaApiKey = process.env.TBA_API_KEY;

  if (tbaApiKey && teamStats.length > 0) {
    await Promise.all(
      teamStats.map(async (t) => {
        try {
          const res = await fetch(
            `https://www.thebluealliance.com/api/v3/team/frc${t.team}`,
            {
              headers: { 'X-TBA-Auth-Key': tbaApiKey },
              next: { revalidate: 3600 }, 
            }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.nickname) {
              teamNames[t.team] = data.nickname;
            }
          }
        } catch {
          // Fallback silently if individual team fetch fails
        }
      })
    );
  }

  return (
    <>
      <PageHeader
        icon={Bot}
        title="Teams"
        description="Pick a team to see its averages, every scouted match, the pit interview, and any cards."
        aside={<RealtimeConnection initialCursor={lastSeq} initialNames={names} />}
      />
      <TeamsClientView initialTeams={teamStats} teamNames={teamNames} />
    </>
  );
}
