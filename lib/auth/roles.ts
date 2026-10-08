// Who may do what: the roles, every permission, and the rules for managing
// other accounts. The server calls these for each protected operation; the
// browser uses them only to hide controls the server would refuse. Pure and
// framework-free, so the Node realtime server, Next.js, and the tests share it.
//
//   OWNER       set by AUTH_OWNER_EMAILS only. Every permission; the only role that
//               manages mentors and changes anyone's name. Never assignable.
//   MENTOR      operations panel, audit log, manages scout leads, scouts, members.
//   SCOUT_LEAD  denies and allows access, manages scouts and members.
//   SCOUT       reads the dashboard (marks who scouts).
//   MEMBER      reads the dashboard. Everyone starts here.

export const ROLES = ["MEMBER", "SCOUT", "SCOUT_LEAD", "MENTOR", "OWNER"] as const;
export type Role = (typeof ROLES)[number];

/** Roles the admin panel can hand out. OWNER comes from configuration only. */
export const ASSIGNABLE_ROLES = ["MEMBER", "SCOUT", "SCOUT_LEAD", "MENTOR"] as const satisfies readonly Role[];

/**
 * Anyone who signs in with Google starts `active`. A manager can turn an account
 * `disabled` (shown as "Denied") and back. Accounts saved before open access
 * may still say `pending`; they read as `active` (see {@link accountStatus}).
 */
export const ACCOUNT_STATUSES = ["active", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** The status as enforced: only `disabled` blocks access. */
export function accountStatus(value: unknown): AccountStatus { return value === "disabled" ? "disabled" : "active"; }

const RANK: Record<Role, number> = { MEMBER: 0, SCOUT: 1, SCOUT_LEAD: 2, MENTOR: 3, OWNER: 4 };

export const ROLE_LABELS: Record<Role, string> = { MEMBER: "Member", SCOUT: "Scout", SCOUT_LEAD: "Scout lead", MENTOR: "Mentor", OWNER: "Owner" };
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  MEMBER: "Reads the scouting dashboard.",
  SCOUT: "Scouts matches; reads the dashboard.",
  SCOUT_LEAD: "Denies and allows access; manages scouts and members.",
  MENTOR: "Operations panel and audit log; manages scout leads, scouts, and members.",
  OWNER: "Everything. Set in the server configuration; the only one who manages mentors and changes names.",
};

export function isAssignableRole(value: unknown): value is (typeof ASSIGNABLE_ROLES)[number] { return typeof value === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(value); }
export function isAccountStatus(value: unknown): value is AccountStatus { return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value); }
export function roleRank(role: Role): number { return RANK[role]; }

/**
 * Roles saved before the Owner/Mentor model (ADMIN, ROOT) become MENTOR, and a
 * stored OWNER that is not in the configuration is only a MENTOR: ownership
 * lives in AUTH_OWNER_EMAILS, never in the database.
 */
export function storedRole(value: unknown): Exclude<Role, "OWNER"> {
  if (value === "ADMIN" || value === "ROOT" || value === "OWNER") return "MENTOR";
  return isAssignableRole(value) ? value : "MEMBER";
}

/**
 * Operations that need more than a signed-in account, and the lowest role that
 * may perform them. Every one also requires an `active` account.
 */
export const PERMISSIONS = {
  /** Every scouting page, the dashboard REST API, and the realtime feed. */
  "dashboard:read": "MEMBER",
  /** The user list and account details. */
  "users:read": "SCOUT_LEAD",
  /** Deny or allow access, change roles, revoke sessions (further limited by {@link canManageUser}). */
  "users:manage": "SCOUT_LEAD",
  /** Change display and scout names, anyone's, including your own. */
  "users:rename": "OWNER",
  /** System health, realtime/sync/API monitoring. */
  "ops:read": "MENTOR",
  /** Run on-demand health checks (writes one short-lived diagnostic document to the account store). */
  "ops:diagnose": "MENTOR",
  "audit:read": "MENTOR",
} as const satisfies Record<string, Role>;
export type Permission = keyof typeof PERMISSIONS;

/** What authorization decisions need to know about an account. Always loaded server-side. */
export interface Principal { id: string; role: Role; status: AccountStatus }

/** The Owner passes every check; everyone else needs an active account with a high enough role. */
export function can(principal: Principal | null | undefined, permission: Permission): boolean {
  if (!principal) return false;
  if (principal.role === "OWNER") return true;
  return principal.status === "active" && RANK[principal.role] >= RANK[PERMISSIONS[permission]];
}

/**
 * Whether `actor` may change `target`'s account. Nobody manages their own
 * account (no self-elevation or self-lockout), nobody manages an Owner, and
 * otherwise only accounts strictly below the actor's role.
 */
export function canManageUser(actor: Principal | null | undefined, target: Principal): boolean {
  if (!actor || !can(actor, "users:manage")) return false;
  if (actor.id === target.id || target.role === "OWNER") return false;
  return RANK[target.role] < RANK[actor.role];
}

/** Roles `actor` may hand out: strictly below their own, and never OWNER. */
export function assignableRoles(actor: Principal | null | undefined): Role[] {
  if (!actor || !can(actor, "users:manage")) return [];
  return ASSIGNABLE_ROLES.filter((role) => RANK[role] < RANK[actor.role]);
}

export function canAssignRole(actor: Principal | null | undefined, target: Principal, role: Role): boolean {
  return canManageUser(actor, target) && assignableRoles(actor).includes(role);
}

/** The admin area's sections and who may open them (the matching API routes check the same permission). */
export const ADMIN_SECTIONS = [
  { href: "/admin", label: "Overview", permission: "ops:read" },
  { href: "/admin/realtime", label: "Realtime", permission: "ops:read" },
  { href: "/admin/sync", label: "Sync", permission: "ops:read" },
  { href: "/admin/api", label: "API", permission: "ops:read" },
  { href: "/admin/users", label: "Users", permission: "users:read" },
  { href: "/admin/audit", label: "Audit log", permission: "audit:read" },
  { href: "/admin/diagnostics", label: "Diagnostics", permission: "ops:diagnose" },
] as const satisfies ReadonlyArray<{ href: string; label: string; permission: Permission }>;

export function canOpenAdmin(principal: Principal | null | undefined): boolean {
  return ADMIN_SECTIONS.some((section) => can(principal, section.permission));
}
