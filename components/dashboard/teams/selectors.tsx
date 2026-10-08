'use client';

import { useMemo } from 'react';
import { labelClass } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';
import type { MatchData } from '@/lib/data/team-documents';
import { NativeSelect } from './primitives';

interface TeamSelectorProps {
  teams: TeamAggregate[];
  selectedTeam: TeamAggregate | null;
  teamNames: Record<number, string>;
  onSelectTeam: (team: TeamAggregate) => void;
}

export function TeamSelector({ teams, selectedTeam, teamNames, onSelectTeam }: TeamSelectorProps) {
  const items = useMemo(
    () => teams.map((t) => ({
      label: teamNames[t.team] || t.name ? `${t.team} - ${teamNames[t.team] || t.name}` : `Team ${t.team}`,
      value: t.team.toString(),
    })),
    [teams, teamNames]
  );
  const select = (value: string) => {
    const team = teams.find((t) => t.team.toString() === value);
    if (team) onSelectTeam(team);
  };

  return (
    <div>
      <label htmlFor="team-select" className={`mb-1.5 block ${labelClass}`}>Team</label>
      <NativeSelect id="team-select" value={selectedTeam ? selectedTeam.team.toString() : null} onChange={select} options={items} placeholder="Select a team" />
    </div>
  );
}

interface MatchSelectorProps {
  matches: MatchData[];
  selectedMatch: MatchData | null;
  onSelectMatch: (match: MatchData) => void;
}

export function MatchSelector({ matches, selectedMatch, onSelectMatch }: MatchSelectorProps) {
  if (!matches || matches.length === 0) return null;

  const items = matches.map((m, idx) => ({
    label: `Match ${m.start?.match ?? idx + 1}${m.start?.practice ? ' (practice)' : ''}`,
    value: idx.toString(),
  }));
  const selectedIndex = selectedMatch ? matches.indexOf(selectedMatch) : -1;
  const select = (value: string) => {
    const match = matches[parseInt(value, 10)];
    if (match) onSelectMatch(match);
  };

  return (
    <div>
      <label htmlFor="match-select" className={`mb-1.5 block ${labelClass}`}>Match</label>
      <NativeSelect id="match-select" value={selectedIndex >= 0 ? selectedIndex.toString() : null} onChange={select} options={items} placeholder="Select a match" />
    </div>
  );
}
