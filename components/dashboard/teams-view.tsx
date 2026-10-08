// The Teams page body. Holds the selected team and match, loads that team's documents, and shows them as Event
// → Team → Match objects.
'use client';

import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { EmptyState } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';
import { useScoutingEvent, useTeamDocuments } from '@/lib/realtime/hooks';
import { MATCH_DOC_ID_PREFIX, docTeam, toMatchData } from '@/lib/data/team-documents';
import { Match } from '@/lib/domain/match';
import { PitInterview } from '@/lib/domain/pit-interview';
import type { Team } from '@/lib/domain/team';
import { Section } from './teams/primitives';
import { MatchSelector, TeamSelector } from './teams/selectors';
import { TeamStatSummary } from './teams/team-summary';
import { MatchDetails } from './teams/match-details';
import { AutoPathVisualization } from './teams/auto-path';
import { MatchDataTable } from './teams/match-log';
import { ExpertScoutReport } from './teams/scout-report';
import { CardReportsTable } from './teams/card-reports';

/** Teams page body: pick a team, then browse its averages, matches, pit interview and cards. */
interface TeamsClientViewProps {
  initialTeams: TeamAggregate[];
  teamNames?: Record<number, string>;
}

/** The Teams page body: team and match pickers over the selected team's panels. */
export default function TeamsClientView({ initialTeams, teamNames = {} }: TeamsClientViewProps) {
  const event = useScoutingEvent(initialTeams);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(initialTeams[0]?.team ?? null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const summary = event.teamOrFirst(selectedTeamId);
  const { matches, pit, loading } = useTeamDetail(summary?.number);
  // The selected team with its loaded matches and pit interview: Event → Team → Match.
  const team = summary?.withDetail({ matches, pit }) ?? null;
  const selectedMatch = matches.find((match) => match._id === selectedMatchId) ?? matches[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TeamSelector teams={event.teams} selectedTeam={team} teamNames={teamNames} onSelectTeam={(picked) => { setSelectedTeamId(picked.number); setSelectedMatchId(null); }} />
        <MatchSelector matches={matches} selectedMatch={selectedMatch} onSelectMatch={(match) => setSelectedMatchId(match._id ?? null)} />
      </div>
      {team ? <TeamPanels team={team} nickname={teamNames[team.number]} selectedMatch={selectedMatch} loading={loading} /> : (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface">
          <EmptyState icon={Bot} title="No teams available yet.">
            Teams appear once the first match of the event is scouted and synced.
          </EmptyState>
        </div>
      )}
    </div>
  );
}

interface TeamPanelsProps { team: Team; nickname?: string; selectedMatch: Match | null; loading: boolean }

function TeamPanels({ team, nickname, selectedMatch, loading }: TeamPanelsProps) {
  return (
    <>
      <TeamStatSummary team={team.aggregate} nickname={nickname} />

      {loading && <p className="text-sm text-muted" role="status">Loading match data…</p>}

      {selectedMatch && (
        <div className="grid gap-5 xl:grid-cols-2">
          <MatchDetails match={selectedMatch} />
          <AutoPathVisualization match={selectedMatch} />
        </div>
      )}

      <MatchDataTable matches={team.matches} />

      <ExpertScoutReport pit={team.pit} teamNumber={team.number} />

      <Section title="Card Reports">
        <CardReportsTable teamNumber={team.number} />
      </Section>
    </>
  );
}

/** The selected team's match log and pit interview, as REST results with realtime changes applied. */
function useTeamDetail(team: number | undefined) {
  const match = useTeamDocuments('matches', team, new RegExp(`^${MATCH_DOC_ID_PREFIX}${team}_\\d+$`));
  const pit = useTeamDocuments('pit', team, new RegExp(`^pit_${team}$`));
  const matches = useMemo(
    () => match.docs
      .filter((doc) => docTeam(doc) === String(team))
      .map((doc) => new Match(toMatchData(doc)))
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    [match.docs, team]
  );
  const teamPit = pit.docs.find((doc) => docTeam(doc) === String(team));
  return { matches, pit: teamPit ? PitInterview.fromDocument(teamPit) : null, loading: match.loading || pit.loading };
}
