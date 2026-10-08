// Append-only audit log of security and administrative events. The app only
// ever creates audit documents: there is no update or delete path, and reading
// needs `audit:read`. Entries hold identifiers and outcomes, never tokens,
// codes, secrets, or cookies (metadata is reduced to short scrubbed scalars).
import { randomBytes } from "node:crypto";
import { recordError, scrub } from "../ops/metrics.ts";
import type { Role } from "./roles.ts";
import type { AccountStore } from "./store.ts";

export type AuditResult = "success" | "denied" | "failure";

interface AuditActor { id: string; email?: string; role?: Role }
interface AuditTarget { type: "user" | "session" | "system"; id?: string; label?: string }

interface AuditEvent {
  type: "audit";
  at: string;
  action: string;
  result: AuditResult;
  actor?: AuditActor;
  target?: AuditTarget;
  reason?: string;
  meta?: Record<string, string | number | boolean | null>;
}
export interface AuditEntry extends AuditEvent { id: string }

export const AUDIT_PREFIX = "audit_";

/** Ids sort by time: `audit_<ms, 14 digits>_<random>`. */
function auditId(now = Date.now()) {
  return `${AUDIT_PREFIX}${String(now).padStart(14, "0")}_${randomBytes(5).toString("hex")}`;
}

const SENSITIVE_KEY = /token|secret|password|code|cookie|authorization|verifier|nonce|state/i;

function cleanMeta(meta: Record<string, unknown> | undefined): AuditEvent["meta"] {
  if (!meta) return undefined;
  const out: NonNullable<AuditEvent["meta"]> = {};
  for (const [key, value] of Object.entries(meta).slice(0, 20)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) out[key.slice(0, 40)] = value;
    else if (typeof value === "string") out[key.slice(0, 40)] = scrub(value).slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
}

// Denied requests are recorded, but a client hammering an endpoint must not flood the log.
const DENIAL_WINDOW_MS = 60_000;
const recentDenials = new Map<string, number>();

export interface AuditInput { action: string; result: AuditResult; actor?: AuditActor | null; target?: AuditTarget; reason?: string; meta?: Record<string, unknown> }

/** Writes an audit entry. Never throws: a store outage must not turn a sign-out or an admin action into a crash. */
export async function recordAudit(store: AccountStore | null, input: AuditInput): Promise<string | null> {
  if (input.result === "denied") {
    const key = `${input.actor?.id ?? "anonymous"}:${input.action}:${input.target?.id ?? ""}`;
    const last = recentDenials.get(key);
    if (last && Date.now() - last < DENIAL_WINDOW_MS) return null;
    recentDenials.set(key, Date.now());
    if (recentDenials.size > 5000) recentDenials.clear();
  }
  if (!store) return null;
  const event: AuditEvent = {
    type: "audit",
    at: new Date().toISOString(),
    action: input.action.slice(0, 64),
    result: input.result,
    ...(input.actor ? { actor: { id: input.actor.id, ...(input.actor.email ? { email: input.actor.email } : {}), ...(input.actor.role ? { role: input.actor.role } : {}) } } : {}),
    ...(input.target ? { target: { type: input.target.type, ...(input.target.id ? { id: input.target.id.slice(0, 80) } : {}), ...(input.target.label ? { label: input.target.label.slice(0, 120) } : {}) } } : {}),
    ...(input.reason ? { reason: scrub(input.reason).slice(0, 200) } : {}),
    ...(cleanMeta(input.meta) ? { meta: cleanMeta(input.meta) } : {}),
  };
  const id = auditId();
  try { await store.create(id, event); return id; } catch (error) { recordError("audit", error); return null; }
}

export interface AuditQuery { limit?: number; before?: string; action?: string; result?: AuditResult; search?: string }

const SCAN_WINDOW = 500;

/**
 * Newest first. One read of the audit documents (on Sync Gateway that is one
 * pass over the `_changes` feed), then one window of up to 500 entries before
 * `before`; filters apply within that window, and `next` continues from it.
 */
export async function listAudit(store: AccountStore, query: AuditQuery = {}): Promise<{ entries: AuditEntry[]; next: string | null; scanned: number }> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const all = (await store.list<AuditEvent>(AUDIT_PREFIX)).filter((row) => !query.before || row.id < query.before);
  const windowRows = all.slice(-SCAN_WINDOW);
  const window = windowRows.map((row) => row.id);
  const docs = windowRows.filter((row): row is { id: string; rev: string; body: AuditEvent } => row.body !== undefined);
  const search = query.search?.trim().toLowerCase();
  const entries = docs
    .filter((doc) => doc.body.type === "audit")
    .map((doc): AuditEntry => ({ ...doc.body, id: doc.id }))
    .filter((entry) => (!query.action || entry.action === query.action || entry.action.startsWith(`${query.action}.`)) && (!query.result || entry.result === query.result))
    .filter((entry) => !search || [entry.action, entry.actor?.email, entry.actor?.id, entry.target?.label, entry.target?.id, entry.reason].some((value) => value?.toLowerCase().includes(search)))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  const page = entries.slice(0, limit);
  const more = entries.length > limit || all.length > window.length;
  const next = more ? (entries.length > limit ? page.at(-1)!.id : window[0] ?? null) : null;
  return { entries: page, next, scanned: window.length };
}
