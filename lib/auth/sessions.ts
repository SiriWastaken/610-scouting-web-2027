// Server-side sessions. The browser holds an opaque random token in an
// HttpOnly cookie; the account store keeps only its SHA-256, so a leaked store
// cannot be replayed as a login. Every request re-reads the session and the
// account (through a short cache), so role changes, disabling, and revocation
// take effect without the user signing in again.
import { getUser, isUserId, principalFor, type UserDoc } from "./accounts.ts";
import type { AuthConfig, ProviderId } from "./config.ts";
import { randomToken, sha256Hex } from "./sign-in.ts";
import type { Principal } from "./roles.ts";
import type { AccountStore } from "./store.ts";
import { authMetrics } from "../ops/metrics.ts";

export interface SessionDoc {
  type: "auth_session";
  userId: string;
  provider: ProviderId;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  /** Browser/OS summary for the account panel ("Chrome on macOS"); never the full header. */
  device?: string;
}

export interface Viewer {
  userId: string;
  user: UserDoc;
  principal: Principal;
  session: { id: string; provider: ProviderId; createdAt: string; expiresAt: string; idleExpiresAt: string; lastSeenAt: string; device?: string };
}

export const SESSION_PREFIX = "session_";
export const sessionCookieName = (config: Pick<AuthConfig, "secureCookies">) => (config.secureCookies ? "__Host-610_session" : "610_session");

const TOUCH_INTERVAL_MS = 5 * 60_000;
const CACHE_MS = 10_000;

const sessionDocId = (userId: string, secret: string) => `${SESSION_PREFIX}${userId}_${sha256Hex(secret).slice(0, 48)}`;

function parseToken(token: string | undefined | null): { userId: string; secret: string } | null {
  if (!token || token.length > 200) return null;
  const [userId, secret, extra] = token.split(".");
  if (extra !== undefined || !isUserId(userId) || !secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { userId, secret };
}

export function describeDevice(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : undefined;
  const os = /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "macOS" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : undefined;
  return browser || os ? [browser ?? "Browser", os].filter(Boolean).join(" on ") : "Unknown device";
}

// Keyed by the token's hash; shared across module copies in one process (see lib/ops/metrics.ts).
const CACHE_KEY = Symbol.for("610-scouting.session-cache");
type CacheEntry = { viewer: Viewer; rev: string; cachedAt: number };
const cache = (): Map<string, CacheEntry> => ((globalThis as Record<symbol, unknown>)[CACHE_KEY] ??= new Map()) as Map<string, CacheEntry>;

/** Drops cached sessions for an account so a change to it applies on the next request in this process. */
export function invalidateUserSessions(userId: string) {
  for (const [key, entry] of cache()) if (entry.viewer.userId === userId) cache().delete(key);
}

export async function createSession(store: AccountStore, config: AuthConfig, userId: string, provider: ProviderId, userAgent?: string | null): Promise<{ token: string; expiresAt: Date }> {
  const secret = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + config.sessionMaxAgeMs);
  await store.create<SessionDoc>(sessionDocId(userId, secret), {
    type: "auth_session", userId, provider,
    createdAt: new Date(now).toISOString(), expiresAt: expiresAt.toISOString(), lastSeenAt: new Date(now).toISOString(),
    device: describeDevice(userAgent),
  });
  return { token: `${userId}.${secret}`, expiresAt };
}

export type SessionCheck = { ok: true; viewer: Viewer } | { ok: false; reason: "missing" | "malformed" | "unknown" | "expired" | "disabled" };

/**
 * Resolves a session token to the signed-in viewer, or says why it cannot.
 * Throws StoreUnavailableError when the account store is down, so callers can
 * answer 503 instead of pretending the user is signed out.
 */
export async function validateSession(store: AccountStore, config: AuthConfig, token: string | undefined | null, now = Date.now()): Promise<SessionCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const parsed = parseToken(token);
  if (!parsed) { authMetrics.sessionRejected(); return { ok: false, reason: "malformed" }; }
  const id = sessionDocId(parsed.userId, parsed.secret);
  const cached = cache().get(id);
  if (cached && now - cached.cachedAt < CACHE_MS && Date.parse(cached.viewer.session.expiresAt) > now && Date.parse(cached.viewer.session.idleExpiresAt) > now) return { ok: true, viewer: cached.viewer };

  const session = await store.get<SessionDoc>(id);
  if (!session || session.body.type !== "auth_session" || session.body.userId !== parsed.userId) { cache().delete(id); authMetrics.sessionRejected(); return { ok: false, reason: "unknown" }; }
  const idleExpiresAt = Date.parse(session.body.lastSeenAt) + config.sessionIdleMs;
  if (Date.parse(session.body.expiresAt) <= now || idleExpiresAt <= now) {
    cache().delete(id); authMetrics.sessionRejected();
    await store.remove(id, session.rev).catch(() => {});
    return { ok: false, reason: "expired" };
  }
  const user = await getUser(store, parsed.userId);
  if (!user) { cache().delete(id); authMetrics.sessionRejected(); return { ok: false, reason: "unknown" }; }
  const principal = principalFor(config, parsed.userId, user.body);
  if (principal.status === "disabled") {
    cache().delete(id); authMetrics.sessionRejected();
    await store.remove(id, session.rev).catch(() => {});
    return { ok: false, reason: "disabled" };
  }

  let lastSeenAt = session.body.lastSeenAt;
  let rev = session.rev;
  if (now - Date.parse(lastSeenAt) > TOUCH_INTERVAL_MS) {
    // Sliding idle expiry. A concurrent touch from another tab is harmless, so conflicts are ignored.
    const touched = { ...session.body, lastSeenAt: new Date(now).toISOString() };
    try { rev = await store.update(id, session.rev, touched); lastSeenAt = touched.lastSeenAt; } catch { /* keep the old value */ }
  }
  const viewer: Viewer = {
    userId: parsed.userId, user: user.body, principal,
    session: { id, provider: session.body.provider, createdAt: session.body.createdAt, expiresAt: session.body.expiresAt, idleExpiresAt: new Date(Date.parse(lastSeenAt) + config.sessionIdleMs).toISOString(), lastSeenAt, device: session.body.device },
  };
  cache().set(id, { viewer, rev, cachedAt: now });
  if (cache().size > 5000) cache().clear();
  return { ok: true, viewer };
}

/** Ends one session (sign-out). Returns false when it was already gone. */
export async function revokeSession(store: AccountStore, token: string | undefined | null): Promise<boolean> {
  const parsed = parseToken(token);
  if (!parsed) return false;
  const id = sessionDocId(parsed.userId, parsed.secret);
  cache().delete(id);
  const session = await store.get<SessionDoc>(id);
  return session ? store.remove(id, session.rev).catch(() => false) : false;
}

export async function listUserSessions(store: AccountStore, userId: string): Promise<Array<{ id: string; rev: string; session: SessionDoc }>> {
  if (!isUserId(userId)) return [];
  return (await store.list<SessionDoc>(`${SESSION_PREFIX}${userId}_`)).flatMap((doc) => doc.body?.type === "auth_session" ? [{ id: doc.id, rev: doc.rev, session: doc.body }] : []);
}

/** Ends every session of an account (disable, "sign out everywhere", admin revoke). Returns how many were ended. */
export async function revokeUserSessions(store: AccountStore, userId: string, options: { except?: string } = {}): Promise<number> {
  invalidateUserSessions(userId);
  let revoked = 0;
  for (const { id, rev } of await listUserSessions(store, userId)) {
    if (id === options.except) continue;
    if (await store.remove(id, rev).catch(() => false)) revoked += 1;
  }
  return revoked;
}

/** Deletes sessions that can no longer be used, so the store does not grow without bound. */
async function pruneExpiredSessions(store: AccountStore, config: AuthConfig, userId: string, now = Date.now()) {
  for (const { id, rev, session } of await listUserSessions(store, userId)) {
    if (Date.parse(session.expiresAt) <= now || Date.parse(session.lastSeenAt) + config.sessionIdleMs <= now) await store.remove(id, rev).catch(() => {});
  }
}

/**
 * Right after a successful sign-in: ends the browser's previous session and
 * clears this account's expired ones. Best effort, because neither failing may
 * block the sign-in (the old session expires on its own and pruning repeats at
 * the next sign-in).
 */
export async function endPreviousSession(store: AccountStore, config: AuthConfig, userId: string, previousToken: string | undefined | null) {
  try { await revokeSession(store, previousToken); } catch { /* expires on its own */ }
  try { await pruneExpiredSessions(store, config, userId); } catch { /* pruned next time */ }
}

/** Reads one cookie from a raw Cookie header (used where no framework cookie API exists, e.g. WebSocket upgrades). */
export function readCookie(header: string | string[] | null | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join("; ") : header;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}
