'use client';

import { useMemo } from 'react';
import { labelClass, selectClass } from '@/components/ui/kit';
import type { TeamAggregate } from '@/types/scouting';
import type { MatchData } from '@/lib/data/team-documents';

export function NativeSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string | null;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
}) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${selectClass} h-11 text-base sm:text-sm`}>
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

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
