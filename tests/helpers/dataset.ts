import type { GatewayTarget } from "./gateway-target.ts";

/** Writes documents through the gateway's REST API, as scouting devices do, and returns their revisions. */
export async function seedDocuments(target: GatewayTarget, documents: Record<string, Record<string, unknown>>): Promise<Map<string, string>> {
  const revisions = new Map<string, string>();
  for (const [id, body] of Object.entries(documents)) revisions.set(id, await target.upsert(id, body));
  return revisions;
}

/** Points the app's server-side Couchbase access code at `target`. */
export function useGatewayForApp(target: GatewayTarget) {
  Object.assign(process.env, target.appEnv());
}
