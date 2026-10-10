// Reads the scouting database's connection settings (COUCHBASE_*) from the environment and builds the changes-feed
// URL and Authorization header from them. Server-only values; never sent to a browser.
/** Connection details for the scouting database on Sync Gateway. */
export interface CouchbaseConnectionConfig {
  baseUrl: string;
  database: string;
  username: string;
  password: string;
  scope: string;
  collection: string;
}

/** The scouting database settings, or null when any of the four required variables is missing or empty. */
export function readCouchbaseConfig(env: NodeJS.ProcessEnv = process.env): CouchbaseConnectionConfig | null {
  // Keep Couchbase connection details on the server. `.env.local` is ignored
  // by Git; production should set these same names in the hosting environment.
  const baseUrl = env.COUCHBASE_SYNC_GATEWAY_URL;
  const database = env.COUCHBASE_DATABASE;
  const username = env.COUCHBASE_USERNAME;
  const password = env.COUCHBASE_PASSWORD;
  if (!baseUrl || !database || !username || !password) return null;
  return {
    baseUrl,
    database,
    username,
    password,
    scope: env.COUCHBASE_SCOPE ?? "_default",
    collection: env.COUCHBASE_COLLECTION ?? "_default",
  };
}

/** The changes-feed URL (http/https, database name encoded) and Basic auth header, or null when unconfigured. */
export function getCouchbaseChangesConfig(config = readCouchbaseConfig()): { url: string; authorization: string } | null {
  if (!config) return null;
  return {
    url: `${config.baseUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "")}/${encodeURIComponent(config.database)}/_changes`,
    authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
  };
}
