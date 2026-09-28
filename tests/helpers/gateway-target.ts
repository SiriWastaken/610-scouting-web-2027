// A Sync Gateway the tests can write to and read back from: the in-memory fake
// (default) or a real, disposable Sync Gateway + Couchbase Server
// (`TEST_SG_TARGET=real`, provisioned by `scripts/test-infra/couchbase-up.sh`).
// Writes go through the public REST API exactly as a scouting device makes them.
import { FAKE_DATABASE, FAKE_PASSWORD, FAKE_USERNAME, FakeSyncGateway } from "./fake-sync-gateway.ts";

export interface WriteResult { status: number; rev?: string; body: Record<string, unknown> }

export interface GatewayTarget {
  kind: "fake" | "real";
  /** Public REST origin, e.g. `http://127.0.0.1:4984`. */
  origin: string;
  database: string;
  username: string;
  password: string;
  authorization: string;
  changesUrl: string;
  /** Present only for the fake: fault injection and raw row injection. */
  fake?: FakeSyncGateway;
  /** Environment for a dashboard server that should read from this gateway. */
  appEnv(): Record<string, string>;
  /** PUT through the REST API; pass `rev` to update. Does not throw on 4xx. */
  write(id: string, body: Record<string, unknown>, rev?: string): Promise<WriteResult>;
  /** DELETE through the REST API. Does not throw on 4xx. */
  remove(id: string, rev: string): Promise<WriteResult>;
  /** Reads the persisted document back; null when missing or deleted. */
  read(id: string): Promise<Record<string, unknown> | null>;
  /** Create-or-update helper: reads the current revision and writes over it. Throws on failure. */
  upsert(id: string, body: Record<string, unknown>): Promise<string>;
  /** Deletes if present. Throws on failure. */
  destroy(id: string): Promise<string | undefined>;
  /** The current end of the changes feed, as the dashboard snapshot reports it. */
  lastSeq(): Promise<string>;
  /** Deletes every document this target created, so the next suite starts clean. Called by stop(). */
  cleanup(): Promise<void>;
  stop(): Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  // A missing variable must fail the run, never quietly fall back to the fake.
  if (!value) throw new Error(`TEST_SG_TARGET=real requires ${name}. Provision one with scripts/test-infra/couchbase-up.sh (see tests/README.md).`);
  return value;
}

export async function startGatewayTarget(): Promise<GatewayTarget> {
  const mode = process.env.TEST_SG_TARGET ?? "fake";
  if (mode !== "fake" && mode !== "real") throw new Error(`Unknown TEST_SG_TARGET "${mode}" (expected "fake" or "real")`);
  if (mode === "fake") {
    const fake = new FakeSyncGateway();
    await fake.start();
    return makeTarget("fake", fake.origin, FAKE_DATABASE, FAKE_USERNAME, FAKE_PASSWORD, () => fake.stop(), fake);
  }
  const origin = requireEnv("TEST_SG_URL").replace(/\/$/, "");
  const target = makeTarget("real", origin, requireEnv("TEST_SG_DATABASE"), requireEnv("TEST_SG_USERNAME"), requireEnv("TEST_SG_PASSWORD"), async () => {});
  await assertDisposable(target);
  return target;
}

/**
 * Refuses to run against a database that holds live dashboard documents, so a
 * mistyped URL can never point the tests (which write and delete) at real
 * scouting data.
 */
async function assertDisposable(target: GatewayTarget) {
  const response = await fetch(`${target.origin}/${encodeURIComponent(target.database)}/_changes?since=0&include_docs=false`, { headers: { Authorization: target.authorization } });
  if (!response.ok) throw new Error(`Real Sync Gateway is not reachable at ${target.origin} (HTTP ${response.status}). Tests never fall back to the fake.`);
  const payload = await response.json() as { results?: Array<{ id?: string; deleted?: boolean }> };
  const live = (payload.results ?? []).filter((row) => !row.deleted && row.id && !row.id.startsWith("_") && !row.id.startsWith("bench_"));
  if (live.length > 0 && process.env.TEST_SG_ALLOW_EXISTING !== "1") {
    throw new Error(`Refusing to run: ${target.database} already holds ${live.length} live documents (e.g. ${live[0].id}). Use a disposable database.`);
  }
}

function makeTarget(kind: "fake" | "real", origin: string, database: string, username: string, password: string, stop: () => Promise<void>, fake?: FakeSyncGateway): GatewayTarget {
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const docUrl = (id: string, rev?: string) => `${origin}/${encodeURIComponent(database)}/${encodeURIComponent(id)}${rev ? `?rev=${encodeURIComponent(rev)}` : ""}`;
  const call = async (method: string, url: string, body?: unknown): Promise<WriteResult> => {
    const response = await fetch(url, {
      method,
      headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
    return { status: response.status, rev: typeof parsed.rev === "string" ? parsed.rev : undefined, body: parsed };
  };
  const created = new Set<string>();
  const target: GatewayTarget = {
    kind, origin, database, username, password, authorization, fake,
    changesUrl: `${origin}/${encodeURIComponent(database)}/_changes`,
    appEnv: () => ({ COUCHBASE_SYNC_GATEWAY_URL: origin, COUCHBASE_DATABASE: database, COUCHBASE_USERNAME: username, COUCHBASE_PASSWORD: password }),
    write: (id, body, rev) => { created.add(id); return call("PUT", docUrl(id, rev), body); },
    remove: (id, rev) => call("DELETE", docUrl(id, rev)),
    async read(id) {
      const response = await fetch(docUrl(id), { headers: { Authorization: authorization, Accept: "application/json" } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`GET ${id} failed with HTTP ${response.status}`);
      return await response.json() as Record<string, unknown>;
    },
    async upsert(id, body) {
      const current = await target.read(id);
      const result = await target.write(id, body, typeof current?._rev === "string" ? current._rev : undefined);
      if (result.status !== 201 || !result.rev) throw new Error(`PUT ${id} failed: HTTP ${result.status} ${JSON.stringify(result.body)}`);
      return result.rev;
    },
    async destroy(id) {
      const current = await target.read(id);
      if (!current) return undefined;
      const result = await target.remove(id, String(current._rev));
      if (result.status !== 200 || !result.rev) throw new Error(`DELETE ${id} failed: HTTP ${result.status} ${JSON.stringify(result.body)}`);
      return result.rev;
    },
    async lastSeq() {
      let since = "0";
      // Page to the end of the feed; the same request the dashboard snapshot makes, without documents.
      for (;;) {
        const response = await fetch(`${target.changesUrl}?since=${encodeURIComponent(since)}&limit=1000`, { headers: { Authorization: authorization } });
        if (!response.ok) throw new Error(`_changes failed with HTTP ${response.status}`);
        const payload = await response.json() as { results?: unknown[]; last_seq?: unknown };
        const next = String(payload.last_seq ?? since);
        if (!payload.results?.length || next === since) return next;
        since = next;
      }
    },
    async cleanup() {
      for (const id of created) await target.destroy(id);
      created.clear();
    },
    async stop() {
      // The fake disappears with its process; a real database must be left as it was found.
      if (kind === "real") await target.cleanup();
      await stop();
    },
  };
  return target;
}
