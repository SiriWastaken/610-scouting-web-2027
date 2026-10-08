// User accounts: turning a verified provider identity into an account at
// sign-in, and every change made to an account afterwards. Authorization for
// changes is decided here with lib/auth/roles.ts, never by the caller.
import { randomBytes } from "node:crypto";
import type { AuthConfig, ProviderId } from "./config.ts";
import { sha256Hex } from "./sign-in.ts";
import { ASSIGNABLE_ROLES, accountStatus, can, canAssignRole, canManageUser, isAccountStatus, isAssignableRole, storedRole, type AccountStatus, type Principal, type Role } from "./roles.ts";
import { ConflictError, type AccountStore, type StoredDoc } from "./store.ts";

export interface UserDoc {
  type: "auth_user";
  email: string;
  emailVerified: boolean;
  /** Shown everywhere in the app; only the Owner may change it. */
  displayName: string;
  /** The name the provider reported, kept for reference. */
  providerName?: string;
  /** Profile photo URL from Google (https, Google-hosted only). */
  picture?: string;
  /** Never OWNER: ownership comes from AUTH_OWNER_EMAILS. Older values (ADMIN, ROOT) read as MENTOR. */
  role: Exclude<Role, "OWNER">;
  /** `pending` only appears on accounts saved before open access; it reads as `active`. */
  status: AccountStatus | "pending";
  /** The name this person uses on scouting tablets, linking them to their submissions. Only the Owner may change it. */
  scoutName?: string;
  /** Visible to account managers only. */
  adminNote?: string;
  /** Strings, not ProviderId: accounts that once signed in with a provider that has since been removed keep their history. */
  providers: string[];
  createdAt: string;
  updatedAt: string;
  lastSignInAt?: string;
  lastSignInProvider?: string;
  /** Who allowed access: `automatic` (first Google sign-in), `configuration` (Owner), or a manager's account id. */
  approvedBy?: string;
  approvedAt?: string;
}

interface IdentityDoc { type: "auth_identity"; provider: ProviderId; userId: string; createdAt: string }
interface EmailIndexDoc { type: "auth_email"; userId: string }

export interface VerifiedIdentity { provider: ProviderId; subject: string; email?: string; emailVerified: boolean; name?: string; picture?: string }

export const USER_PREFIX = "user_";
export const isUserId = (value: unknown): value is string => typeof value === "string" && /^u[0-9a-f]{20}$/.test(value);
export const userDocId = (userId: string) => `${USER_PREFIX}${userId}`;
const identityDocId = (provider: ProviderId, subject: string) => `identity_${provider}_${sha256Hex(`${provider}:${subject}`).slice(0, 40)}`;
const emailDocId = (email: string) => `email_${sha256Hex(email.toLowerCase()).slice(0, 40)}`;
const newUserId = () => `u${randomBytes(10).toString("hex")}`;

export class AccountError extends Error {
  readonly code: "forbidden" | "invalid" | "not_found" | "conflict";
  constructor(code: AccountError["code"], message: string) { super(message); this.code = code; }
}

function isOwnerEmail(config: AuthConfig, email: string) { return config.ownerEmails.has(email.toLowerCase()); }

/** Role and status as enforced: Owner emails are always an active OWNER, whatever the stored document says. */
export function principalFor(config: AuthConfig, userId: string, user: UserDoc): Principal {
  if (isOwnerEmail(config, user.email)) return { id: userId, role: "OWNER", status: "active" };
  return { id: userId, role: storedRole(user.role), status: accountStatus(user.status) };
}

/** Only https Google profile photos are kept; anything else would let a provider profile point the app at arbitrary URLs. */
export function safePicture(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)googleusercontent\.com$/.test(url.hostname) ? url.toString() : undefined;
  } catch { return undefined; }
}

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/g;
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

function defaultName(identity: VerifiedIdentity) {
  return cleanText(identity.name, 80) ?? identity.email?.split("@")[0] ?? "Scout";
}

export type SignInOutcome =
  | { ok: true; userId: string; user: UserDoc; created: boolean; linked: boolean }
  | { ok: false; reason: "email_unverified" | "no_email" | "disabled"; userId?: string; user?: UserDoc };

async function withRetry<T>(attempt: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i += 1) {
    try { return await attempt(); } catch (error) { if (!(error instanceof ConflictError) || i >= tries) throw error; }
  }
}

/**
 * Finds or creates the account for a verified identity. Identities are looked
 * up by provider subject first; a new identity is linked to an existing account
 * only through a provider-verified email address. Creation is race-safe: the
 * email index document can only be created once.
 */
export async function resolveSignIn(store: AccountStore, config: AuthConfig, identity: VerifiedIdentity): Promise<SignInOutcome> {
  const email = identity.email?.toLowerCase();
  const identityId = identityDocId(identity.provider, identity.subject);
  const now = new Date().toISOString();
  let userId = (await store.get<IdentityDoc>(identityId))?.body.userId;
  let created = false; let linked = false;

  if (!userId) {
    if (!email) return { ok: false, reason: "no_email" };
    if (!identity.emailVerified) return { ok: false, reason: "email_unverified" };
    userId = (await store.get<EmailIndexDoc>(emailDocId(email)))?.body.userId;
    if (userId) linked = true;
    else {
      const candidate = newUserId();
      try {
        await store.create<EmailIndexDoc>(emailDocId(email), { type: "auth_email", userId: candidate });
        // Everyone starts as an active MEMBER; the Owner's power comes from configuration, not this document.
        await store.create<UserDoc>(userDocId(candidate), {
          type: "auth_user", email, emailVerified: true, displayName: defaultName(identity), providerName: cleanText(identity.name, 80),
          picture: identity.provider === "google" ? safePicture(identity.picture) : undefined,
          role: "MEMBER", status: "active",
          providers: [], createdAt: now, updatedAt: now,
          approvedBy: isOwnerEmail(config, email) ? "configuration" : "automatic", approvedAt: now,
        });
        userId = candidate; created = true;
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        // Someone else created this email's account at the same moment: use theirs.
        userId = (await store.get<EmailIndexDoc>(emailDocId(email)))?.body.userId;
        if (!userId) throw error;
        linked = true;
      }
    }
    try { await store.create<IdentityDoc>(identityId, { type: "auth_identity", provider: identity.provider, userId, createdAt: now }); }
    catch (error) { if (!(error instanceof ConflictError)) throw error; }
  }

  const finalUserId = userId;
  const updated = await withRetry(async () => {
    const current = await store.get<UserDoc>(userDocId(finalUserId));
    if (!current) throw new AccountError("not_found", "The account for this sign-in no longer exists");
    const user = current.body;
    const next: UserDoc = {
      ...user,
      providers: [...new Set([...user.providers, identity.provider])],
      providerName: cleanText(identity.name, 80) ?? user.providerName,
      ...(identity.provider === "google" && safePicture(identity.picture) ? { picture: safePicture(identity.picture) } : {}),
      lastSignInAt: now, lastSignInProvider: identity.provider, updatedAt: now,
    };
    if (isOwnerEmail(config, user.email) && next.status !== "active") { next.status = "active"; next.approvedBy = "configuration"; next.approvedAt = now; }
    else if (next.status === "pending") { next.status = "active"; next.approvedBy = "automatic"; next.approvedAt = now; } // saved before open access
    if (principalFor(config, finalUserId, next).status === "disabled") return next; // leave a disabled account untouched
    await store.update(userDocId(finalUserId), current.rev, next);
    return next;
  });
  if (principalFor(config, finalUserId, updated).status === "disabled") return { ok: false, reason: "disabled", userId: finalUserId, user: updated };
  return { ok: true, userId: finalUserId, user: updated, created, linked };
}

export async function getUser(store: AccountStore, userId: string): Promise<StoredDoc<UserDoc> | null> {
  if (!isUserId(userId)) return null;
  const doc = await store.get<UserDoc>(userDocId(userId));
  return doc && doc.body.type === "auth_user" ? doc : null;
}

export interface AdminPatch { displayName?: string; scoutName?: string | null; adminNote?: string | null; role?: Exclude<Role, "OWNER">; status?: AccountStatus }
export interface ProfilePatch { displayName?: string; scoutName?: string | null }

const ADMIN_FIELDS = new Set(["displayName", "scoutName", "adminNote", "role", "status", "expectedRev"]);
const PROFILE_FIELDS = new Set(["displayName", "scoutName"]);

/** Strict parsing: unknown fields are rejected, not ignored, so a forged `role` in a profile update is visible. */
export function parsePatch(body: unknown, kind: "admin" | "profile"): { ok: true; patch: AdminPatch & { expectedRev?: string } } | { ok: false; error: string; forbiddenFields?: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Expected a JSON object" };
  const allowed = kind === "admin" ? ADMIN_FIELDS : PROFILE_FIELDS;
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) return { ok: false, error: `Fields not allowed: ${unknown.slice(0, 5).join(", ")}`, forbiddenFields: unknown };
  const input = body as Record<string, unknown>;
  const patch: AdminPatch & { expectedRev?: string } = {};
  if ("displayName" in input) {
    const name = cleanText(input.displayName, 80);
    if (!name) return { ok: false, error: "Display name must be 1-80 characters" };
    patch.displayName = name;
  }
  for (const [field, max] of [["scoutName", 60], ["adminNote", 500]] as const) {
    if (!(field in input)) continue;
    if (input[field] === null || input[field] === "") { patch[field] = null; continue; }
    if (typeof input[field] !== "string") return { ok: false, error: `${field} must be text` };
    patch[field] = cleanText(input[field], max) ?? null;
  }
  if ("role" in input) { if (!isAssignableRole(input.role)) return { ok: false, error: `role must be one of ${ASSIGNABLE_ROLES.join(", ")} (OWNER is set in the server configuration)` }; patch.role = input.role; }
  if ("status" in input) { if (!isAccountStatus(input.status)) return { ok: false, error: "status must be active or disabled" }; patch.status = input.status; }
  if ("expectedRev" in input) { if (typeof input.expectedRev !== "string" || input.expectedRev.length > 200) return { ok: false, error: "expectedRev must be a revision string" }; patch.expectedRev = input.expectedRev; }
  if (Object.keys(patch).filter((key) => key !== "expectedRev").length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, patch };
}

/** Whether a change touches a name; only the Owner may make those. */
const changesNames = (patch: AdminPatch | ProfilePatch) => patch.displayName !== undefined || patch.scoutName !== undefined;

/**
 * Applies a manager's change to another account. Checks, in order: the actor
 * may manage this account at all, may change names (Owner only), and may grant
 * the requested role.
 */
export async function adminUpdateUser(store: AccountStore, config: AuthConfig, actor: Principal, targetId: string, patch: AdminPatch & { expectedRev?: string }): Promise<{ before: UserDoc; after: UserDoc; rev: string }> {
  const current = await getUser(store, targetId);
  if (!current) throw new AccountError("not_found", "No such account");
  const target = principalFor(config, targetId, current.body);
  if (actor.id === targetId) throw new AccountError("forbidden", "You cannot change your own role or status");
  if (!canManageUser(actor, target)) throw new AccountError("forbidden", target.role === "OWNER" ? "The Owner is set in the server configuration (AUTH_OWNER_EMAILS) and can't be changed here" : "Your role cannot manage this account");
  if (changesNames(patch) && !can(actor, "users:rename")) throw new AccountError("forbidden", "Only the Owner can change names");
  if (patch.role !== undefined && patch.role !== storedRole(current.body.role) && !canAssignRole(actor, target, patch.role)) throw new AccountError("forbidden", `Your role cannot grant ${patch.role}`);
  if (patch.expectedRev && patch.expectedRev !== current.rev) throw new AccountError("conflict", "This account was changed by someone else. Reload and try again.");

  const now = new Date().toISOString();
  const next: UserDoc = { ...current.body, role: storedRole(current.body.role), updatedAt: now };
  if (patch.displayName !== undefined) next.displayName = patch.displayName;
  if (patch.scoutName !== undefined) { if (patch.scoutName === null) delete next.scoutName; else next.scoutName = patch.scoutName; }
  if (patch.adminNote !== undefined) { if (patch.adminNote === null) delete next.adminNote; else next.adminNote = patch.adminNote; }
  if (patch.role !== undefined) next.role = patch.role;
  if (patch.status !== undefined) {
    if (patch.status === "active" && accountStatus(current.body.status) !== "active") { next.approvedBy = actor.id; next.approvedAt = now; }
    next.status = patch.status;
  }
  try {
    const rev = await store.update(userDocId(targetId), current.rev, next);
    return { before: current.body, after: next, rev };
  } catch (error) {
    if (error instanceof ConflictError) throw new AccountError("conflict", "This account was changed by someone else. Reload and try again.");
    throw error;
  }
}

/** Changing your own names: allowed only for the Owner, like every other name change. */
export async function updateOwnProfile(store: AccountStore, principal: Principal, patch: ProfilePatch): Promise<UserDoc> {
  if (changesNames(patch) && !can(principal, "users:rename")) throw new AccountError("forbidden", "Only the Owner can change names");
  return withRetry(async () => {
    const current = await getUser(store, principal.id);
    if (!current) throw new AccountError("not_found", "No such account");
    const next: UserDoc = { ...current.body, updatedAt: new Date().toISOString() };
    if (patch.displayName !== undefined) next.displayName = patch.displayName;
    if (patch.scoutName !== undefined) { if (patch.scoutName === null) delete next.scoutName; else next.scoutName = patch.scoutName; }
    await store.update(userDocId(principal.id), current.rev, next);
    return next;
  });
}

/** What the browser may know about an account. `admin` adds manager-only fields. */
export function publicUser(config: AuthConfig, userId: string, user: UserDoc, view: "self" | "admin" = "self") {
  const principal = principalFor(config, userId, user);
  return {
    id: userId, email: user.email, displayName: user.displayName, picture: user.picture ?? null,
    role: principal.role, status: principal.status,
    providers: user.providers, lastSignInProvider: user.lastSignInProvider ?? null,
    scoutName: user.scoutName ?? null, createdAt: user.createdAt, lastSignInAt: user.lastSignInAt ?? null,
    ...(view === "admin" ? { providerName: user.providerName ?? null, adminNote: user.adminNote ?? null, approvedBy: user.approvedBy ?? null, approvedAt: user.approvedAt ?? null, updatedAt: user.updatedAt } : {}),
  };
}
