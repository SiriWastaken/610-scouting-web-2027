// Accounts, sign-in identities, sessions, and the audit log, kept in their own
// Sync Gateway database (never the scouting database the tablets replicate).
// Every update names the revision it read, so two concurrent admin edits can
// never silently overwrite each other: the loser gets a ConflictError.
import { recordStoreRequest } from "../ops/metrics.ts";
import { storeKeyspace, type AuthStoreConfig } from "./config.ts";

export class StoreUnavailableError extends Error {}
export class ConflictError extends Error {}

export interface StoredDoc<T> { id: string; rev: string; body: T }

/**
 * What the account, session, and audit code needs from storage. Implemented by
 * AuthStore (Sync Gateway, production) and LocalAuthStore (a file, development only).
 */
export interface AccountStore {
  get<T>(id: string): Promise<StoredDoc<T> | null>;
  /** Fails with ConflictError if the document already exists. */
  create<T extends object>(id: string, body: T): Promise<string>;
  /** Fails with ConflictError unless `rev` is the current revision. */
  update<T extends object>(id: string, rev: string, body: T): Promise<string>;
  remove(id: string, rev: string): Promise<boolean>;
  list<T>(prefix: string, options?: { includeDocs?: boolean }): Promise<Array<StoredDoc<T | undefined>>>;
  getMany<T>(ids: string[]): Promise<Array<StoredDoc<T>>>;
  info(): Promise<{ state: string; updateSeq: unknown; latencyMs: number }>;
}

const TIMEOUT_MS = 8_000;

export class AuthStore implements AccountStore {
  /** Documents: `/{db}` or, for a named collection, `/{db}.{scope}.{collection}`. */
  private readonly base: string;
  /** Database-level endpoints such as `GET /{db}/`. */
  private readonly databaseBase: string;
  private readonly authorization: string;
  private readonly database: string;
  private readonly keyspace: string;
  private readonly named: boolean;

  constructor(config: AuthStoreConfig) {
    this.database = config.database;
    this.keyspace = storeKeyspace(config);
    this.named = this.keyspace !== config.database;
    this.base = `${config.url}/${encodeURIComponent(this.keyspace)}`;
    this.databaseBase = `${config.url}/${encodeURIComponent(config.database)}`;
    this.authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  }

  private async request(method: string, path: string, body?: unknown, base = this.base): Promise<{ status: number; json: Record<string, unknown> }> {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: this.authorization, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      recordStoreRequest(false, Date.now() - started, error);
      throw new StoreUnavailableError(`Account store unreachable: ${error instanceof Error ? error.name : "network error"}`);
    }
    let json: Record<string, unknown> = {};
    try { const text = await response.text(); json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    // Sync Gateway answers 404 both for a missing document and for a database that does not exist.
    // The second is a configuration error, never "this account doesn't exist yet".
    const missingDatabase = response.status === 404 && /database|keyspace/i.test(String(json.reason ?? ""));
    const failed = response.status >= 500 || response.status === 401 || response.status === 403 || missingDatabase;
    const problem = failed ? this.describeFailure(method, response.status, json, missingDatabase) : undefined;
    recordStoreRequest(!failed, Date.now() - started, problem);
    if (problem) throw new StoreUnavailableError(problem);
    return { status: response.status, json };
  }

  /** A message that says what to fix, using Sync Gateway's own reason (never credentials). */
  private describeFailure(method: string, status: number, json: Record<string, unknown>, missingDatabase: boolean): string {
    const reason = typeof json.reason === "string" ? json.reason.slice(0, 160) : "";
    if (missingDatabase && this.named && /keyspace|collection/i.test(reason)) {
      return `Account store collection "${this.keyspace}" is not available on Sync Gateway (create it, and on Capella App Services link it to the "${this.database}" App Endpoint; see docs/authentication.md)`;
    }
    if (missingDatabase && /keyspace/i.test(reason)) {
      // The database answers, but not its default collection: common on Capella, where App Endpoints serve one scope's collections.
      return `"${this.database}" has no default collection on Sync Gateway; set AUTH_STORE_SCOPE and AUTH_STORE_COLLECTION to the collection that holds accounts (e.g. app / auth)`;
    }
    if (missingDatabase) return `Account store database "${this.database}" does not exist on Sync Gateway (create it; see docs/authentication.md)`;
    if (status === 401) return `Account store rejected AUTH_STORE_USERNAME/AUTH_STORE_PASSWORD for "${this.database}" (HTTP 401)`;
    if (status === 403) return `Account store user may not ${method === "GET" ? "read" : "write"} documents in "${this.keyspace}" (HTTP 403${reason ? `: ${reason}` : ""}); give it access to all channels ("*") in that collection and a sync function that accepts its writes`;
    return `Account store returned HTTP ${status}${reason ? `: ${reason}` : ""}`;
  }

  private static unexpected(action: string, status: number, json: Record<string, unknown>) {
    const reason = typeof json.reason === "string" ? `: ${json.reason.slice(0, 160)}` : "";
    return new StoreUnavailableError(`Could not ${action} (HTTP ${status}${reason})`);
  }

  private static docPath(id: string, rev?: string) {
    return `/${encodeURIComponent(id)}${rev ? `?rev=${encodeURIComponent(rev)}` : ""}`;
  }

  async get<T>(id: string): Promise<StoredDoc<T> | null> {
    const { status, json } = await this.request("GET", AuthStore.docPath(id));
    if (status === 404) return null;
    if (status !== 200 || typeof json._rev !== "string") throw AuthStore.unexpected("read a document", status, json);
    const { _id: _ignoredId, _rev: rev, ...body } = json;
    void _ignoredId;
    return { id, rev: rev as string, body: body as T };
  }

  /** Creates a document that must not exist yet (uniqueness: email index, identities). */
  async create<T extends object>(id: string, body: T): Promise<string> {
    const { status, json } = await this.request("PUT", AuthStore.docPath(id), body);
    if (status === 409) throw new ConflictError(`${id} already exists`);
    if (status !== 201 || typeof json.rev !== "string") throw AuthStore.unexpected("create a document", status, json);
    return json.rev;
  }

  async update<T extends object>(id: string, rev: string, body: T): Promise<string> {
    const { status, json } = await this.request("PUT", AuthStore.docPath(id, rev), body);
    if (status === 409) throw new ConflictError(`${id} changed since it was read`);
    if (status !== 201 || typeof json.rev !== "string") throw AuthStore.unexpected("update a document", status, json);
    return json.rev;
  }

  async remove(id: string, rev: string): Promise<boolean> {
    const { status, json } = await this.request("DELETE", AuthStore.docPath(id, rev));
    if (status === 404) return false;
    if (status === 409) throw new ConflictError(`${id} changed since it was read`);
    if (status !== 200) throw AuthStore.unexpected("delete a document", status, json);
    return true;
  }

  /**
   * Every live document in the collection, read through the `_changes` feed (one row per document,
   * current revision). `_all_docs` would be simpler, but Capella App Services disables it on the
   * public endpoint; `_changes` is always served. Pages through the feed 1000 rows at a time.
   */
  private async scan(includeDocs: boolean, keep: (id: string) => boolean): Promise<Array<StoredDoc<Record<string, unknown> | undefined>>> {
    const docs = new Map<string, StoredDoc<Record<string, unknown> | undefined>>();
    let since = "0";
    for (let page = 0; page < 1000; page += 1) {
      const params = new URLSearchParams({ since, limit: "1000", include_docs: String(includeDocs), style: "main_only" });
      const { status, json } = await this.request("GET", `/_changes?${params}`);
      if (status !== 200 || !Array.isArray(json.results)) throw AuthStore.unexpected("list documents", status, json);
      const rows = json.results as Array<{ id?: unknown; deleted?: unknown; removed?: unknown; changes?: Array<{ rev?: unknown }>; doc?: Record<string, unknown> }>;
      for (const row of rows) {
        if (typeof row.id !== "string" || !keep(row.id)) continue;
        // A later row for the same document supersedes an earlier one; deletions and channel removals drop it.
        if (row.deleted === true || row.removed !== undefined || row.doc?._deleted === true) { docs.delete(row.id); continue; }
        const rev = typeof row.changes?.[0]?.rev === "string" ? row.changes[0].rev : typeof row.doc?._rev === "string" ? row.doc._rev : "";
        let body: Record<string, unknown> | undefined;
        if (row.doc) { const { _id: _ignoredId, _rev: _ignoredRev, ...rest } = row.doc; void _ignoredId; void _ignoredRev; body = rest; }
        docs.set(row.id, { id: row.id, rev, body });
      }
      const next = json.last_seq === undefined ? since : String(json.last_seq);
      if (rows.length === 0 || next === since) break;
      since = next;
    }
    return [...docs.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Every live document whose id starts with `prefix`, in id order. */
  async list<T>(prefix: string, options: { includeDocs?: boolean } = {}): Promise<Array<StoredDoc<T | undefined>>> {
    return await this.scan(options.includeDocs !== false, (id) => id.startsWith(prefix)) as Array<StoredDoc<T | undefined>>;
  }

  /** Reads several documents at once; missing and deleted ones are left out. */
  async getMany<T>(ids: string[]): Promise<Array<StoredDoc<T>>> {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return (await this.scan(true, (id) => wanted.has(id))).filter((doc) => doc.body !== undefined) as Array<StoredDoc<T>>;
  }

  /** Database state as Sync Gateway reports it (`GET /{db}/`), with round-trip latency. */
  async info(): Promise<{ state: string; updateSeq: unknown; latencyMs: number }> {
    const started = Date.now();
    const { status, json } = await this.request("GET", "/", undefined, this.databaseBase);
    if (status !== 200) throw AuthStore.unexpected("read the account store's database info", status, json);
    if (this.named) {
      // The database answering says nothing about the collection: make sure Sync Gateway serves it.
      const probe = await this.request("GET", `/_changes?limit=1&since=0`);
      if (probe.status !== 200) throw AuthStore.unexpected(`read collection "${this.keyspace}"`, probe.status, probe.json);
    }
    return { state: typeof json.state === "string" ? json.state : "unknown", updateSeq: json.update_seq, latencyMs: Date.now() - started };
  }
}
