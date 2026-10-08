import { LivePage } from '@/components/dashboard/live-page';
import TeamsClientView from '@/components/dashboard/teams-view';
import { fetchTeamNickname } from '@/services/blue-alliance';

export default function TeamsPage() {
  return <LivePage href="/teams">{async ({ teams }) => <TeamsClientView initialTeams={teams} teamNames={await nicknames(teams.map((t) => t.team))} />}</LivePage>;
}

/** Team nicknames from The Blue Alliance, looked up server-side so the API key stays private. */
async function nicknames(teamNumbers: number[]): Promise<Record<number, string>> {
  const names: Record<number, string> = {};
  await Promise.all(teamNumbers.map(async (team) => {
    const nickname = await fetchTeamNickname(team);
    if (nickname) names[team] = nickname;
  }));
  return names;
}
