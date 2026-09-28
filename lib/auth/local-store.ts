// A development-only account store: the same documents and rules as the Sync
// Gateway store (revision-checked writes, create-once ids), kept in a JSON file
// on this machine. For working on the app before the real account collection
// is reachable. config.ts refuses it when NODE_ENV is production.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ConflictError, type AccountStore, type StoredDoc } from "./store.ts";

interface Entry { rev: string; body: Record<string, unknown>; seq: number }
interface State { path: string; docs: Map<string, Entry>; seq: number }

// One state per file per process, shared by scripts/server.mjs and Next's bundled copy of this module.
const stateFor = (path: string): State => {
  const key = Symbol.for(`610-scouting.local-account-store:${path}`);
  const holder = globalThis as Record<symbol, State | undefined>;
  if (!holder[key]) {
    const state: State = { path, docs: new Map(), seq: 0 };
    try {
      const saved = JSON.parse(readFileSync(path, "utf8")) as { seq?: number; docs?: Record<string, Entry> };
      state.seq = saved.seq ?? 0;
      for (const [id, entry] of Object.entries(saved.docs ?? {})) state.docs.set(id, entry);
    } catch { /* no file yet: start empty */ }
    holder[key] = state;
  }
  return holder[key]!;
};

export class LocalAuthStore implements AccountStore {
  private readonly state: State;

  constructor(path: string) { this.state = stateFor(resolve(path)); }

  private save() {
    mkdirSync(dirname(this.state.path), { recursive: true });
    const temporary = `${this.state.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ seq: this.state.seq, docs: Object.fromEntries(this.state.docs) }), { mode: 0o600 });
    renameSync(temporary, this.state.path); // atomic: a crash never leaves half a file
  }

  private write(id: string, body: object, generation: number): string {
    const rev = `${generation}-${randomBytes(8).toString("hex")}`;
    this.state.docs.set(id, { rev, body: JSON.parse(JSON.stringify(body)) as Record<string, unknown>, seq: ++this.state.seq });
    this.save();
    return rev;
  }

  async get<T>(id: string): Promise<StoredDoc<T> | null> {
    const entry = this.state.docs.get(id);
    return entry ? { id, rev: entry.rev, body: structuredClone(entry.body) as T } : null;
  }

  async create<T extends object>(id: string, body: T): Promise<string> {
    if (this.state.docs.has(id)) throw new ConflictError(`${id} already exists`);
    return this.write(id, body, 1);
  }

  async update<T extends object>(id: string, rev: string, body: T): Promise<string> {
    const entry = this.state.docs.get(id);
    if (!entry || entry.rev !== rev) throw new ConflictError(`${id} changed since it was read`);
    return this.write(id, body, Number(entry.rev.split("-")[0]) + 1);
  }

  async remove(id: string, rev: string): Promise<boolean> {
    const entry = this.state.docs.get(id);
    if (!entry) return false;
    if (entry.rev !== rev) throw new ConflictError(`${id} changed since it was read`);
    this.state.docs.delete(id);
    this.state.seq += 1;
    this.save();
    return true;
  }

  async list<T>(prefix: string, options: { includeDocs?: boolean } = {}): Promise<Array<StoredDoc<T | undefined>>> {
    return [...this.state.docs.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, entry]) => ({ id, rev: entry.rev, body: options.includeDocs === false ? undefined : structuredClone(entry.body) as T }));
  }

  async getMany<T>(ids: string[]): Promise<Array<StoredDoc<T>>> {
    return ids.flatMap((id) => { const entry = this.state.docs.get(id); return entry ? [{ id, rev: entry.rev, body: structuredClone(entry.body) as T }] : []; });
  }

  async info() {
    return { state: "Online (local development file)", updateSeq: this.state.seq, latencyMs: 0 };
  }
}
