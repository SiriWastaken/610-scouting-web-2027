export interface CouchbaseConnectionConfig {
  baseUrl: string;
  database: string;
  username: string;
  password: string;
  scope: string;
  collection: string;
}

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

export function getCouchbaseChangesConfig(config = readCouchbaseConfig()): { url: string; authorization: string } | null {
  if (!config) return null;
  return {
    url: `${config.baseUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "")}/${encodeURIComponent(config.database)}/_changes`,
    authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
  };
}
