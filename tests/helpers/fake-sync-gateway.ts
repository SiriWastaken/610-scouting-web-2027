import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface StoredDoc { rev: string; body?: Record<string, unknown>; deleted: boolean; seq: number }
type Waiter = () => void;

export const FAKE_DATABASE = "scouting";
export const FAKE_AUTH = `Basic ${Buffer.from("user:pass").toString("base64")}`;

/**
 * A small in-memory stand-in for Sync Gateway's `_changes` REST endpoint:
 * numeric sequences, one row per document (its latest revision), `normal` and
 * `longpoll` feeds, `since`, `limit`, and `include_docs`.
 */
export class FakeSyncGateway {
  readonly docs = new Map<string, StoredDoc>();
  private seq = 0;
  private waiters = new Set<Waiter>();
  private server: Server | undefined;
  /** Raw rows returned (once) ahead of real changes, for malformed or replayed events. */
  private injected: unknown[] = [];
  private failures: number[] = [];
  requests: URL[] = [];
  openLongPolls = 0;

  get lastSeq() { return this.seq; }

  async start(port = 0): Promise<string> {
    this.server = createServer((request, response) => { void this.handle(request, response); });
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/${FAKE_DATABASE}/_changes`;
  }

  async stop() {
    this.waiters.forEach((wake) => wake());
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  /** Creates or updates a document, bumping its revision generation like Couchbase does. */
  put(id: string, body: Record<string, unknown>): string {
    const previous = this.docs.get(id);
    const rev = `${(previous ? Number(previous.rev.split("-")[0]) : 0) + 1}-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;
    this.docs.set(id, { rev, body, deleted: false, seq: ++this.seq });
    this.wake();
    return rev;
  }

  delete(id: string): string {
    const previous = this.docs.get(id);
    const rev = `${(previous ? Number(previous.rev.split("-")[0]) : 0) + 1}-${"d".repeat(8)}`;
    this.docs.set(id, { rev, deleted: true, seq: ++this.seq });
    this.wake();
    return rev;
  }

  /** Delivers these raw rows on the next changes response, before any real changes. */
  inject(rows: unknown[]) { this.injected.push(...rows); this.wake(); }

  /** The next `count` requests fail with `status`. */
  fail(status: number, count = 1) { for (let i = 0; i < count; i += 1) this.failures.push(status); }

  private wake() { const waiters = [...this.waiters]; this.waiters.clear(); waiters.forEach((wake) => wake()); }

  private rows(since: number, limit: number, includeDocs: boolean) {
    const rows = [...this.docs.entries()]
      .filter(([, doc]) => doc.seq > since)
      .sort(([, a], [, b]) => a.seq - b.seq)
      .slice(0, limit)
      .map(([id, doc]) => ({
        seq: doc.seq, id, changes: [{ rev: doc.rev }],
        ...(doc.deleted ? { deleted: true } : {}),
        ...(includeDocs ? { doc: doc.deleted ? { _id: id, _rev: doc.rev, _deleted: true } : { ...doc.body, _id: id, _rev: doc.rev } } : {}),
      }));
    return rows;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://fake");
    this.requests.push(url);
    const json = (status: number, body: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (request.headers.authorization !== FAKE_AUTH) return json(401, { error: "Unauthorized" });
    // Document writes, as a scouting device would make them through the REST API.
    const docId = url.pathname.startsWith(`/${FAKE_DATABASE}/`) ? decodeURIComponent(url.pathname.slice(FAKE_DATABASE.length + 2)) : "";
    if (docId && docId !== "_changes" && (request.method === "PUT" || request.method === "DELETE")) {
      if (request.method === "DELETE") return json(200, { id: docId, rev: this.delete(docId) });
      let body = "";
      for await (const chunk of request) body += chunk;
      try { return json(201, { id: docId, rev: this.put(docId, JSON.parse(body)) }); } catch { return json(400, { error: "bad json" }); }
    }
    if (url.pathname !== `/${FAKE_DATABASE}/_changes`) return json(404, { error: "not_found" });
    const failure = this.failures.shift();
    if (failure) return json(failure, { error: "injected failure" });

    const sinceParam = url.searchParams.get("since") ?? "0";
    const since = Number(sinceParam);
    if (!/^\d+$/.test(sinceParam)) return json(400, { error: "BadRequest", reason: `Invalid sequence: "${sinceParam}"` });
    const limit = Number(url.searchParams.get("limit") ?? Infinity);
    const includeDocs = url.searchParams.get("include_docs") === "true";
    const timeout = Number(url.searchParams.get("timeout") ?? 0);

    let rows = this.rows(since, limit, includeDocs);
    if (url.searchParams.get("feed") === "longpoll" && rows.length === 0 && this.injected.length === 0) {
      this.openLongPolls += 1;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, timeout);
        function done() { clearTimeout(timer); resolve(); }
        this.waiters.add(done);
        // A client abort closes the response before we write it.
        response.on("close", () => { this.waiters.delete(done); done(); });
      });
      this.openLongPolls -= 1;
      if (response.destroyed || response.writableEnded) return;
      rows = this.rows(since, limit, includeDocs);
    }
    const injected = this.injected.splice(0);
    const results = [...injected, ...rows];
    const lastRow = rows.at(-1);
    json(200, { results, last_seq: String(lastRow ? lastRow.seq : since) });
  }
}
