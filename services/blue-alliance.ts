import "server-only";

const BLUE_ALLIANCE_API_URL = "https://www.thebluealliance.com/api/v3";

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

/** The team's nickname (e.g. "Cheesy Poofs"), or null when TBA is not configured or the call fails. */
export async function fetchTeamNickname(teamNumber: number): Promise<string | null> {
  const team = await tbaFetch<{ nickname?: string }>(`/team/frc${teamNumber}`);
  return team?.nickname || null;
}
