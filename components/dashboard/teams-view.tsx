'use client';

import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { EmptyState } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';
import { useAggregateRealtime, useTeamDocuments } from '@/lib/realtime/hooks';
import { MATCH_DOC_ID_PREFIX, docTeam, toMatchData, type MatchData, type PitData } from '@/lib/data/team-documents';
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

export default function TeamsClientView({ initialTeams, teamNames = {} }: TeamsClientViewProps) {
  const liveTeams = useAggregateRealtime(initialTeams);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(initialTeams[0]?.team ?? null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const selectedTeam = liveTeams.find((team) => team.team === selectedTeamId) ?? liveTeams[0] ?? null;
  const { matches, pitData, loading } = useTeamDetail(selectedTeam?.team);
  const selectedMatch = matches.find((match) => match._id === selectedMatchId) ?? matches[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TeamSelector teams={liveTeams} selectedTeam={selectedTeam} teamNames={teamNames} onSelectTeam={(team) => { setSelectedTeamId(team.team); setSelectedMatchId(null); }} />
        <MatchSelector matches={matches} selectedMatch={selectedMatch} onSelectMatch={(match) => setSelectedMatchId(match._id ?? null)} />
      </div>
      {selectedTeam ? <TeamPanels team={selectedTeam} nickname={teamNames[selectedTeam.team]} matches={matches} selectedMatch={selectedMatch} pitData={pitData} loading={loading} /> : (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface">
          <EmptyState icon={Bot} title="No teams available yet.">
            Teams appear once the first match of the event is scouted and synced.
          </EmptyState>
        </div>
      )}
    </div>
  );
}

interface TeamPanelsProps { team: TeamAggregate; nickname?: string; matches: MatchData[]; selectedMatch: MatchData | null; pitData?: PitData; loading: boolean }

function TeamPanels({ team, nickname, matches, selectedMatch, pitData, loading }: TeamPanelsProps) {
  return (
    <>
      <TeamStatSummary team={team} nickname={nickname} />

      {loading && <p className="text-sm text-muted" role="status">Loading match data…</p>}

      {selectedMatch && (
        <div className="grid gap-5 xl:grid-cols-2">
          <MatchDetails match={selectedMatch} />
          <AutoPathVisualization match={selectedMatch} />
        </div>
      )}

      <MatchDataTable matches={matches} />

      <ExpertScoutReport pitData={pitData} teamNumber={team.team} />

      <Section title="Card Reports">
        <CardReportsTable teamNumber={team.team} />
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
      .map(toMatchData)
      .sort((a, b) => (a.start?.match ?? 0) - (b.start?.match ?? 0)),
    [match.docs, team]
  );
  const teamPit = pit.docs.find((doc) => docTeam(doc) === String(team));
  return { matches, pitData: (teamPit?.data ?? teamPit) as PitData | undefined, loading: match.loading || pit.loading };
}
