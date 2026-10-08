import { parseChangesFrame, isCursor, type RealtimeFrame } from "./protocol.ts";
import { recordUpstreamPoll } from "../ops/metrics.ts";

export interface CouchbaseChangesConfig { url: string; authorization: string }
export type FeedFrameHandler = (frame: RealtimeFrame) => void;
export type FeedReadyHandler = () => void;
export type FeedErrorHandler = (error: FeedError) => void;

/** `resync` means Sync Gateway rejected the cursor, so the client must reload its snapshot. */
class FeedError extends Error {
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

type ChangesPayload = { results?: unknown[]; last_seq?: unknown };

/** Starts relaying the changes feed from `initialCursor`. Returns the function that stops it. */
export function startCouchbaseLongPoll(
  config: CouchbaseChangesConfig,
  initialCursor: unknown,
  onFrame: FeedFrameHandler,
  onReady: FeedReadyHandler,
  onError: FeedErrorHandler,
): () => void {
  const poll = new LongPoll(config, initialCursor, onFrame);
  void poll.run(onReady, onError);
  return () => poll.stop();
}

class LongPoll {
  private stopped = false;
  private active: AbortController | undefined;
  private readonly config: CouchbaseChangesConfig;
  private cursor: unknown;
  private readonly onFrame: FeedFrameHandler;

  constructor(config: CouchbaseChangesConfig, cursor: unknown, onFrame: FeedFrameHandler) {
    this.config = config;
    this.cursor = cursor;
    this.onFrame = onFrame;
  }

  stop() {
    this.stopped = true;
    this.active?.abort();
  }

  async run(onReady: FeedReadyHandler, onError: FeedErrorHandler) {
    try {
      // A short, non-blocking request verifies upstream access before reporting live status.
      const initial = await this.request("normal", 15_000, 1);
      if (this.stopped) return;
      this.deliver(initial);
      onReady();
      while (!this.stopped) {
        const changes = await this.request("longpoll", 25_000, PAGE_SIZE);
        if (this.stopped) return;
        this.deliver(changes);
      }
    } catch (error) {
      if (this.stopped) return;
      recordUpstreamPoll(false, { error });
      onError(error instanceof FeedError ? error : new FeedError(describeFetchError(error)));
    }
  }

  private async request(feed: "normal" | "longpoll", timeoutMs: number, limit: number): Promise<ChangesPayload> {
    const url = new URL(this.config.url);
    url.searchParams.set("feed", feed);
    url.searchParams.set("since", encodeCursor(this.cursor));
    url.searchParams.set("include_docs", "true");
    url.searchParams.set("style", "main_only");
    url.searchParams.set("limit", String(limit));
    if (feed === "longpoll") url.searchParams.set("timeout", String(timeoutMs));
    const controller = this.active = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs + 10_000);
    try {
      const response = await fetch(url, {
        headers: { Authorization: this.config.authorization, Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new FeedError(`Sync Gateway changes feed returned HTTP ${response.status}`, response.status === 400);
      return await response.json() as ChangesPayload;
    } finally {
      clearTimeout(abortTimer);
      this.active = undefined;
    }
  }

  private deliver(payload: ChangesPayload) {
    recordUpstreamPoll(true, { lastSeq: payload.last_seq });
    for (const frame of parseChangesFrame(payload.results ?? [])) this.onFrame(frame);
    if (isCursor(payload.last_seq)) {
      this.cursor = payload.last_seq;
      this.onFrame({ type: "cursor", seq: this.cursor });
    }
  }
}
