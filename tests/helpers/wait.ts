/** Polls until `check` returns a truthy value. Fails with `message` (and optional context) on timeout. */
export async function waitFor<T>(check: () => T | Promise<T>, message: string, timeoutMs = 5000, context?: () => string): Promise<NonNullable<T>> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${message}${context ? `\n${context()}` : ""}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic PRNG (mulberry32) for tests that need varied but reproducible data. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runs `task` over `items` with at most `limit` in flight (a burst from many devices, without exhausting the OS listen backlog). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index], index); }
  }));
  return results;
}
