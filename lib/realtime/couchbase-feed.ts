import { parseChangesFrame, isCursor, type RealtimeFrame } from "./protocol.ts";
import { recordUpstreamPoll } from "../ops/metrics.ts";

export interface CouchbaseChangesConfig { url: string; authorization: string }
export type FeedFrameHandler = (frame: RealtimeFrame) => void;
export type FeedReadyHandler = () => void;
export type FeedErrorHandler = (error: FeedError) => void;

/** `resync` means Sync Gateway rejected the cursor, so the client must reload its snapshot. */
export class FeedError extends Error {
  readonly resync: boolean;
  constructor(message: string, resync = false) { super(message); this.resync = resync; }
}

/** Keeps a reconnecting client's catch-up request bounded; the loop pages through larger backlogs. */
const PAGE_SIZE = 500;

/** `fetch failed` hides the useful part (ENOTFOUND, ECONNREFUSED, ...) in `cause`. */
export function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return "Sync Gateway changes feed failed";
  const cause = (error as { cause?: { code?: string; hostname?: string } }).cause;
  return cause?.code ? `Sync Gateway unreachable (${cause.code}${cause.hostname ? ` ${cause.hostname}` : ""})` : error.message;
}

function encodeCursor(cursor: unknown): string {
  return typeof cursor === "string" ? cursor : JSON.stringify(cursor);
}

export function startCouchbaseLongPoll(
  config: CouchbaseChangesConfig,
  initialCursor: unknown,
  onFrame: FeedFrameHandler,
  onReady: FeedReadyHandler,
  onError: FeedErrorHandler,
): () => void {
  let stopped = false;
  let cursor = initialCursor;
  let activeController: AbortController | undefined;
  const request = async (feed: "normal" | "longpoll", timeoutMs: number, limit?: number) => {
    const url = new URL(config.url);
    url.searchParams.set("feed", feed);
    url.searchParams.set("since", encodeCursor(cursor));
    url.searchParams.set("include_docs", "true");
    url.searchParams.set("style", "main_only");
    if (limit !== undefined) url.searchParams.set("limit", String(limit));
    if (feed === "longpoll") url.searchParams.set("timeout", String(timeoutMs));
    activeController = new AbortController();
    const abortTimer = setTimeout(() => activeController?.abort(), timeoutMs + 10_000);
    try {
      const response = await fetch(url, {
        headers: { Authorization: config.authorization, Accept: "application/json" },
        cache: "no-store",
        signal: activeController.signal,
      });
      if (!response.ok) throw new FeedError(`Sync Gateway changes feed returned HTTP ${response.status}`, response.status === 400);
      return await response.json() as { results?: unknown[]; last_seq?: unknown };
    } finally {
      clearTimeout(abortTimer);
      activeController = undefined;
    }
  };
  const deliver = (payload: { results?: unknown[]; last_seq?: unknown }) => {
    recordUpstreamPoll(true, { lastSeq: payload.last_seq });
    for (const frame of parseChangesFrame(payload.results ?? [])) onFrame(frame);
    if (isCursor(payload.last_seq)) {
      cursor = payload.last_seq;
      onFrame({ type: "cursor", seq: cursor });
    }
  };
  void (async () => {
    try {
      // A short, non-blocking request verifies upstream access before reporting live status.
      const initial = await request("normal", 15_000, 1);
      if (stopped) return;
      deliver(initial);
      onReady();
      while (!stopped) {
        const changes = await request("longpoll", 25_000, PAGE_SIZE);
        if (stopped) return;
        deliver(changes);
      }
    } catch (error) {
      if (stopped) return;
      recordUpstreamPoll(false, { error });
      onError(error instanceof FeedError ? error : new FeedError(describeFetchError(error)));
    }
  })();
  return () => {
    stopped = true;
    activeController?.abort();
  };
}
