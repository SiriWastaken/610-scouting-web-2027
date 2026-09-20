// app/teams/page.tsx
import { fetchTeamAggregates } from '@/services/couchbase';
import TeamsClientView from '@/components/teamClientView';

export default async function TeamsPage() {
  // 1. Fetch team aggregates from Couchbase (Server-side)
  const teamStats = await fetchTeamAggregates();

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
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)] data-grid p-6 md:p-10 font-sans selection:bg-[rgba(120,192,145,0.25)]">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="bg-[var(--panel)] p-6 rounded-2xl border border-[var(--line)] shadow-xl">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">Team Analytics Hub</h1>
          <p className="text-[var(--muted)] text-sm mt-1">
            Web scouting dashboard powered by Couchbase & The Blue Alliance.
          </p>
        </header>

        {/* Pass server-fetched data to the client interactive view */}
        <TeamsClientView initialTeams={teamStats} teamNames={teamNames} />

      </div>
    </main>
  );
}