import { compareRevs, isRev, type RealtimeChange } from "./protocol.ts";

export interface StoredDocument { id: string; rev?: string; seq: unknown; deleted: boolean; doc?: Record<string, unknown> }
type Doc = Record<string, unknown>;

/**
 * Latest known version of every dashboard document seen on the realtime feed,
 * including deletions. Pages merge their REST/server snapshots through it, so a
 * duplicate, stale, or out-of-order event can never replace newer data.
 */
export class DocumentStore {
  private readonly entries = new Map<string, StoredDocument>();

  /** Returns true when the change is new information; false for duplicates and stale revisions. */
  apply(change: RealtimeChange): boolean {
    const current = this.entries.get(change.id);
    if (current) {
      if (change.rev && current.rev) {
        if (compareRevs(change.rev, current.rev) <= 0) return false;
      } else if (JSON.stringify(change.seq) === JSON.stringify(current.seq)) {
        // Without revisions to compare, only an exact replay can be recognised.
        return false;
      }
    }
    this.entries.set(change.id, { id: change.id, rev: change.rev, seq: change.seq, deleted: change.deleted, doc: change.deleted ? undefined : change.doc });
    return true;
  }

  get(id: string): StoredDocument | undefined { return this.entries.get(id); }

  values(): IterableIterator<StoredDocument> { return this.entries.values(); }

  clear() { this.entries.clear(); }

  /**
   * Combines documents loaded outside the feed with what the feed has seen:
   * the newer revision wins, deletions hide stale snapshot copies, and documents
   * created after the snapshot are added.
   */
  merge(documents: Doc[], include: (id: string) => boolean): Doc[] {
    const result = new Map<string, Doc>();
    for (const document of documents) {
      const id = document._id;
      if (typeof id !== "string") continue;
      const stored = this.entries.get(id);
      if (stored && storedIsNewer(stored, document._rev)) {
        if (!stored.deleted && stored.doc) result.set(id, stored.doc);
      } else {
        result.set(id, document);
      }
    }
    for (const stored of this.entries.values()) {
      if (!result.has(stored.id) && !stored.deleted && stored.doc && include(stored.id) && !documents.some((document) => document._id === stored.id)) {
        result.set(stored.id, stored.doc);
      }
    }
    return [...result.values()];
  }
}

export function storedIsNewer(stored: StoredDocument, snapshotRev: unknown): boolean {
  if (!isRev(snapshotRev) || !stored.rev) return true;
  return compareRevs(stored.rev, snapshotRev) >= 0;
}
