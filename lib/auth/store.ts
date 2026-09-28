// Accounts, sign-in identities, sessions, and the audit log, kept in their own
// Sync Gateway database (never the scouting database the tablets replicate).
// Every update names the revision it read, so two concurrent admin edits can
// never silently overwrite each other: the loser gets a ConflictError.
import { recordStoreRequest } from "../ops/metrics.ts";
import type { AuthStoreConfig } from "./config.ts";

export class StoreUnavailableError extends Error {}
export class ConflictError extends Error {}

export interface StoredDoc<T> { id: string; rev: string; body: T }

const TIMEOUT_MS = 8_000;

export class AuthStore {
  private readonly base: string;
  private readonly authorization: string;

  constructor(config: AuthStoreConfig) {
    this.base = `${config.url}/${encodeURIComponent(config.database)}`;
    this.authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, {
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
    const failed = response.status >= 500 || response.status === 401 || response.status === 403;
    recordStoreRequest(!failed, Date.now() - started, failed ? `Account store returned HTTP ${response.status}` : undefined);
    if (failed) throw new StoreUnavailableError(`Account store returned HTTP ${response.status}`);
    return { status: response.status, json };
  }

  private static docPath(id: string, rev?: string) {
    return `/${encodeURIComponent(id)}${rev ? `?rev=${encodeURIComponent(rev)}` : ""}`;
  }

  async get<T>(id: string): Promise<StoredDoc<T> | null> {
    const { status, json } = await this.request("GET", AuthStore.docPath(id));
    if (status === 404) return null;
    if (status !== 200 || typeof json._rev !== "string") throw new StoreUnavailableError(`Unexpected account store response ${status}`);
    const { _id: _ignoredId, _rev: rev, ...body } = json;
    void _ignoredId;
    return { id, rev: rev as string, body: body as T };
  }

  /** Creates a document that must not exist yet (uniqueness: email index, identities). */
  async create<T extends object>(id: string, body: T): Promise<string> {
    const { status, json } = await this.request("PUT", AuthStore.docPath(id), body);
    if (status === 409) throw new ConflictError(`${id} already exists`);
    if (status !== 201 || typeof json.rev !== "string") throw new StoreUnavailableError(`Could not create document (HTTP ${status})`);
    return json.rev;
  }

  async update<T extends object>(id: string, rev: string, body: T): Promise<string> {
    const { status, json } = await this.request("PUT", AuthStore.docPath(id, rev), body);
    if (status === 409) throw new ConflictError(`${id} changed since it was read`);
    if (status !== 201 || typeof json.rev !== "string") throw new StoreUnavailableError(`Could not update document (HTTP ${status})`);
    return json.rev;
  }

  async remove(id: string, rev: string): Promise<boolean> {
    const { status } = await this.request("DELETE", AuthStore.docPath(id, rev));
    if (status === 404) return false;
    if (status === 409) throw new ConflictError(`${id} changed since it was read`);
    if (status !== 200) throw new StoreUnavailableError(`Could not delete document (HTTP ${status})`);
    return true;
  }

  /** Every live document whose id starts with `prefix`, in id order. */
  async list<T>(prefix: string, options: { includeDocs?: boolean } = {}): Promise<Array<StoredDoc<T | undefined>>> {
    const params = new URLSearchParams({ startkey: JSON.stringify(prefix), endkey: JSON.stringify(`${prefix}￿`), include_docs: options.includeDocs === false ? "false" : "true" });
    const { status, json } = await this.request("GET", `/_all_docs?${params}`);
    if (status !== 200 || !Array.isArray(json.rows)) throw new StoreUnavailableError(`Could not list documents (HTTP ${status})`);
    return (json.rows as Array<{ id?: unknown; value?: { rev?: unknown; deleted?: unknown }; doc?: Record<string, unknown> }>).flatMap((row): Array<StoredDoc<T | undefined>> => {
      if (typeof row.id !== "string" || !row.id.startsWith(prefix) || row.value?.deleted) return [];
      const rev = typeof row.value?.rev === "string" ? row.value.rev : typeof row.doc?._rev === "string" ? row.doc._rev : "";
      if (!row.doc) return [{ id: row.id, rev, body: undefined }];
      const { _id: _ignoredId, _rev: _ignoredRev, ...body } = row.doc;
      void _ignoredId; void _ignoredRev;
      return [{ id: row.id, rev, body: body as T }];
    });
  }

  /** Reads several documents in one request (`POST _all_docs` with `keys`); missing ones are left out. */
  async getMany<T>(ids: string[]): Promise<Array<StoredDoc<T>>> {
    if (ids.length === 0) return [];
    const { status, json } = await this.request("POST", "/_all_docs?include_docs=true", { keys: ids });
    if (status !== 200 || !Array.isArray(json.rows)) throw new StoreUnavailableError(`Could not read documents (HTTP ${status})`);
    return (json.rows as Array<{ id?: unknown; value?: { rev?: unknown; deleted?: unknown }; doc?: Record<string, unknown> | null }>).flatMap((row) => {
      if (typeof row.id !== "string" || !row.doc || row.value?.deleted) return [];
      const { _id: _ignoredId, _rev: rev, ...body } = row.doc;
      void _ignoredId;
      return [{ id: row.id, rev: String(rev ?? row.value?.rev ?? ""), body: body as T }];
    });
  }

  /** Database state as Sync Gateway reports it (`GET /{db}/`), with round-trip latency. */
  async info(): Promise<{ state: string; updateSeq: unknown; latencyMs: number }> {
    const started = Date.now();
    const { status, json } = await this.request("GET", "/");
    if (status !== 200) throw new StoreUnavailableError(`Account store database info returned HTTP ${status}`);
    return { state: typeof json.state === "string" ? json.state : "unknown", updateSeq: json.update_seq, latencyMs: Date.now() - started };
  }
}
