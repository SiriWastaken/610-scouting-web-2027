'use client';

import { useMemo } from 'react';
import { labelClass } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';
import type { MatchData } from '@/lib/data/team-documents';
import { NativeSelect } from './primitives';

export function TeamSelector({
  teams,
  selectedTeam,
  teamNames,
  onSelectTeam,
}: {
  teams: TeamAggregate[];
  selectedTeam: TeamAggregate | null;
  teamNames: Record<number, string>;
  onSelectTeam: (team: TeamAggregate) => void;
}) {
  const items = useMemo(
    () =>
      teams.map((t) => ({
        label: teamNames[t.team] || t.name ? `${t.team} - ${teamNames[t.team] || t.name}` : `Team ${t.team}`,
        value: t.team.toString(),
      })),
    [teams, teamNames]
  );

  return (
    <div>
      <label htmlFor="team-select" className={`mb-1.5 block ${labelClass}`}>Team</label>
      <NativeSelect
        id="team-select"
        value={selectedTeam ? selectedTeam.team.toString() : null}
        onChange={(val) => {
          const team = teams.find((t) => t.team.toString() === val);
          if (team) onSelectTeam(team);
        }}
        options={items}
        placeholder="Select a team"
      />
    </div>
  );
}

export function MatchSelector({
  matches,
  selectedMatch,
  onSelectMatch,
}: {
  matches: MatchData[];
  selectedMatch: MatchData | null;
  onSelectMatch: (match: MatchData) => void;
}) {
  if (!matches || matches.length === 0) return null;

  const items = matches.map((m, idx) => ({
    label: `Match ${m.start?.match ?? idx + 1}${m.start?.practice ? ' (practice)' : ''}`,
    value: idx.toString(),
  }));

  const selectedIndex = selectedMatch ? matches.indexOf(selectedMatch) : -1;

  return (
    <div>
      <label htmlFor="match-select" className={`mb-1.5 block ${labelClass}`}>Match</label>
      <NativeSelect
        id="match-select"
        value={selectedIndex >= 0 ? selectedIndex.toString() : null}
        onChange={(val) => {
          const match = matches[parseInt(val, 10)];
          if (match) onSelectMatch(match);
        }}
        options={items}
        placeholder="Select a match"
      />
    </div>
  );
}
