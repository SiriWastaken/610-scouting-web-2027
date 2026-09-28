import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

interface StoredDoc { rev: string; body?: Record<string, unknown>; deleted: boolean; seq: number }
type Waiter = () => void;

export const FAKE_DATABASE = "scouting";
// Distinctive values so leak checks can search for them without matching ordinary words.
export const FAKE_USERNAME = "dashboard-reader";
export const FAKE_PASSWORD = "fake-sg-secret-7f3a91c2";
export const FAKE_AUTH = `Basic ${Buffer.from(`${FAKE_USERNAME}:${FAKE_PASSWORD}`).toString("base64")}`;

/** How the next matching request misbehaves. */
export type Fault =
  | { kind: "status"; status: number }
  /** Accepts the request and never answers (until the client gives up). */
  | { kind: "hang" }
  /** Answers 200 with a body that is not JSON. */
  | { kind: "garbage" }
  /** Drops the TCP connection without a response. */
  | { kind: "reset" };

/**
 * A small in-memory stand-in for the parts of Sync Gateway's public REST API
 * the dashboard and the scouting devices use: `_changes` (numeric sequences,
 * one row per document, `normal` and `longpoll` feeds, `since`, `limit`,
 * `include_docs`), and document GET/PUT/DELETE with revision checks.
 *
 * `tests/contract/` runs the same assertions against this fake and a real
 * Sync Gateway, so the behaviour the other suites rely on is kept honest.
 */
export class FakeSyncGateway {
  readonly docs = new Map<string, StoredDoc>();
  private seq = 0;
  private waiters = new Set<Waiter>();
  private server: Server | undefined;
  /** Raw rows returned (once) ahead of real changes, for malformed or replayed events. */
  private injected: unknown[] = [];
  private faults: Fault[] = [];
  requests: URL[] = [];
  openLongPolls = 0;

  get lastSeq() { return this.seq; }

  async start(port = 0): Promise<string> {
    this.server = createServer((request, response) => { void this.handle(request, response); });
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/${FAKE_DATABASE}/_changes`;
  }

  get origin() {
    const address = this.server?.address() as AddressInfo | undefined;
    if (!address) throw new Error("FakeSyncGateway is not started");
    return `http://127.0.0.1:${address.port}`;
  }

  async stop() {
    this.waiters.forEach((wake) => wake());
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  /** Creates or updates a document without a revision check (an admin write), bumping its generation like Couchbase does. */
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

  /** The next `count` `_changes` requests fail with `status`. */
  fail(status: number, count = 1) { for (let i = 0; i < count; i += 1) this.faults.push({ kind: "status", status }); }

  /** The next `count` `_changes` requests misbehave as described. */
  fault(fault: Fault, count = 1) { for (let i = 0; i < count; i += 1) this.faults.push(fault); }

  clearFaults() { this.faults = []; }

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
    if (request.headers.authorization !== FAKE_AUTH) return json(401, { error: "Unauthorized", reason: "Login required" });
    const docId = url.pathname.startsWith(`/${FAKE_DATABASE}/`) ? decodeURIComponent(url.pathname.slice(FAKE_DATABASE.length + 2)) : "";
    if (docId && docId !== "_changes") return this.handleDocument(docId, request, url, json);
    if (url.pathname !== `/${FAKE_DATABASE}/_changes`) return json(404, { error: "not_found", reason: "no such database" });

    const fault = this.faults.shift();
    if (fault?.kind === "status") return json(fault.status, { error: "injected failure" });
    if (fault?.kind === "garbage") { response.writeHead(200, { "Content-Type": "application/json" }); response.end("<html>proxy error</html>"); return; }
    if (fault?.kind === "reset") { request.socket.destroy(); return; }
    if (fault?.kind === "hang") { await new Promise<void>((resolve) => response.on("close", resolve)); return; }

    const sinceParam = url.searchParams.get("since") ?? "0";
    const since = Number(sinceParam);
    if (!/^\d+$/.test(sinceParam)) return json(400, { error: "Bad Request", reason: `Invalid sequence: "${sinceParam}"` });
    const limit = Number(url.searchParams.get("limit") ?? Infinity) || Infinity;
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

  /**
   * Document writes as a scouting device makes them through the public REST
   * API. Like Sync Gateway, an update or delete must name the current revision
   * (`?rev=` or `_rev`); anything else is a 409 conflict, so a stale write can
   * never silently replace newer data.
   */
  private async handleDocument(docId: string, request: IncomingMessage, url: URL, json: (status: number, body: unknown) => void) {
    const current = this.docs.get(docId);
    if (request.method === "GET") {
      if (!current) return json(404, { error: "not_found", reason: "missing" });
      if (current.deleted) return json(404, { error: "not_found", reason: "deleted" });
      return json(200, { ...current.body, _id: docId, _rev: current.rev });
    }
    if (request.method !== "PUT" && request.method !== "DELETE") return json(405, { error: "Method Not Allowed" });
    let body: Record<string, unknown> = {};
    if (request.method === "PUT") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(400, { error: "Bad Request", reason: "Document body must be a JSON object" });
        body = parsed as Record<string, unknown>;
      } catch { return json(400, { error: "Bad Request", reason: "Bad JSON" }); }
    }
    const baseRev = url.searchParams.get("rev") ?? (typeof body._rev === "string" ? body._rev : undefined);
    const live = current && !current.deleted;
    if (request.method === "DELETE") {
      if (!live) return json(404, { error: "not_found", reason: current ? "deleted" : "missing" });
      if (baseRev !== current.rev) return json(409, { error: "conflict", reason: "Document revision conflict" });
      return json(200, { id: docId, ok: true, rev: this.delete(docId) });
    }
    if (live ? baseRev !== current.rev : baseRev !== undefined && baseRev !== current?.rev) {
      return json(409, { error: "conflict", reason: "Document exists" });
    }
    const content = { ...body };
    delete content._rev; delete content._id;
    return json(201, { id: docId, ok: true, rev: this.put(docId, content) });
  }
}
