'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, RectangleVertical } from 'lucide-react';
import { EmptyState } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';
import { useAggregateRealtime, useRealtimeDocuments, useRealtimeResync } from '@/lib/realtime/hooks';
import {
  MATCH_DOC_ID_PREFIX,
  NO_DOCS,
  docTeam,
  queryDashboardDocuments,
  toMatchData,
  unwrapDoc,
  type PitData,
} from '@/lib/data/team-documents';
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
  const selectedTeam = liveTeams.find((team) => team.team === selectedTeamId) ?? liveTeams[0] ?? null;
  const selectedTeamNumber = selectedTeam?.team;
  const [detail, setDetail] = useState<{ team: number; matches: Record<string, unknown>[]; pit: Record<string, unknown>[] } | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [reloads, setReloads] = useState(0);
  useRealtimeResync(() => setReloads((count) => count + 1));

  useEffect(() => {
    let isMounted = true;

    const loadTeamDetail = async () => {
      if (!selectedTeamNumber) return;
      setLoadingDetail(true);
      try {
        const [matchDocs, pitDocs] = await Promise.all([
          queryDashboardDocuments('matches', selectedTeamNumber),
          queryDashboardDocuments('pit', selectedTeamNumber),
        ]);

        if (matchDocs.length === 0) {
          console.warn(`[TeamsClientView] No "${MATCH_DOC_ID_PREFIX}${selectedTeamNumber}_*" docs found.`);
        }

        if (isMounted) setDetail({ team: selectedTeamNumber, matches: matchDocs.map(unwrapDoc), pit: pitDocs.map(unwrapDoc) });
      } catch (error) {
        console.error('Error loading team detail:', error);
        if (isMounted) setDetail({ team: selectedTeamNumber, matches: [], pit: [] });
      } finally {
        if (isMounted) setLoadingDetail(false);
      }
    };

    loadTeamDetail();
    return () => {
      isMounted = false;
    };
  }, [selectedTeamNumber, reloads]);

  // REST results for the selected team, with realtime creates, updates, and
  // deletes applied on top. Only the affected documents change.
  const loadedDetail = detail?.team === selectedTeamNumber ? detail : null;
  const matchDocs = useRealtimeDocuments(loadedDetail?.matches ?? NO_DOCS, new RegExp(`^${MATCH_DOC_ID_PREFIX}${selectedTeamNumber}_\\d+$`));
  const pitDocs = useRealtimeDocuments(loadedDetail?.pit ?? NO_DOCS, new RegExp(`^pit_${selectedTeamNumber}$`));
  const matches = useMemo(
    () => matchDocs
      .filter((doc) => docTeam(doc) === String(selectedTeamNumber))
      .map(toMatchData)
      .sort((a, b) => (a.start?.match ?? 0) - (b.start?.match ?? 0)),
    [matchDocs, selectedTeamNumber]
  );
  const teamPit = pitDocs.find((doc) => docTeam(doc) === String(selectedTeamNumber));
  const pitData = (teamPit?.data ?? teamPit) as PitData | undefined;
  const selectedMatch = matches.find((match) => match._id === selectedMatchId) ?? matches[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TeamSelector teams={liveTeams} selectedTeam={selectedTeam} teamNames={teamNames} onSelectTeam={(team) => { setSelectedTeamId(team.team); setSelectedMatchId(null); }} />
        <MatchSelector matches={matches} selectedMatch={selectedMatch} onSelectMatch={(match) => setSelectedMatchId(match._id ?? null)} />
      </div>

      {!selectedTeam ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface">
          <EmptyState icon={Bot} title="No teams available yet.">
            Teams appear once the first match of the event is scouted and synced.
          </EmptyState>
        </div>
      ) : (
        <>
          <TeamStatSummary team={selectedTeam} nickname={teamNames[selectedTeam.team]} />

          {loadingDetail && <p className="text-sm text-muted" role="status">Loading match data…</p>}

          {selectedMatch && (
            <div className="grid gap-5 xl:grid-cols-2">
              <MatchDetails match={selectedMatch} />
              <AutoPathVisualization match={selectedMatch} />
            </div>
          )}

          <MatchDataTable matches={matches} />

          <ExpertScoutReport pitData={pitData} teamNumber={selectedTeam.team} />

          <Section title="Card Reports" icon={RectangleVertical}>
            <CardReportsTable teamNumber={selectedTeam.team} />
          </Section>
        </>
      )}
    </div>
  );
}
