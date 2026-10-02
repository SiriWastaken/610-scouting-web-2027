import "server-only";

const BLUE_ALLIANCE_API_URL = "https://www.thebluealliance.com/api/v3";

export interface BlueAllianceRanking {
  rank: number;
  team_key: string;
  record?: { wins: number; losses: number; ties: number };
  qual_average?: number;
  dq?: number;
}

export interface BlueAllianceTeamStatus {
  alliance?: { name?: string; number?: number; pick?: number };
  playoff?: { level?: string; record?: { wins: number; losses: number; ties: number } };
  qual?: { ranking?: number; sort_orders?: number[] };
}

export interface BlueAllianceEvent {
  key: string;
  name: string;
  year: number;
  event_type?: number;
  city?: string;
  state_prov?: string;
}

function getApiKey(): string {
  return process.env.TBA_API_KEY ?? "";
}

/** GET a TBA endpoint. Returns null when no API key is set or the request fails, so callers can fall back. */
async function tbaFetch<T>(path: string): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${BLUE_ALLIANCE_API_URL}${path}`, {
      headers: {
        "X-TBA-Auth-Key": apiKey,
        Accept: "application/json",
        "User-Agent": "610-scouting-web/2027",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      console.error(`Blue Alliance API request failed with status ${response.status}: ${path}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error(`Blue Alliance API request failed: ${path}`, error);
    return null;
  }
}

export function fetchEventRankings(eventKey: string): Promise<BlueAllianceRanking[] | null> {
  return tbaFetch<BlueAllianceRanking[]>(`/event/${encodeURIComponent(eventKey)}/rankings`);
}

/** The team's nickname (e.g. "Cheesy Poofs"), or null when TBA is not configured or the call fails. */
export async function fetchTeamNickname(teamNumber: number): Promise<string | null> {
  const team = await tbaFetch<{ nickname?: string }>(`/team/frc${teamNumber}`);
  return team?.nickname || null;
}

export function fetchTeamStatus(teamNumber: number, eventKey: string): Promise<BlueAllianceTeamStatus | null> {
  return tbaFetch<BlueAllianceTeamStatus>(`/team/frc${teamNumber}/event/${encodeURIComponent(eventKey)}/status`);
}

export function fetchTeamEvents(teamNumber: number, year = 2026): Promise<BlueAllianceEvent[] | null> {
  return tbaFetch<BlueAllianceEvent[]>(`/team/frc${teamNumber}/events/${year}`);
}
