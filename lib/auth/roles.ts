// The role model and every authorization rule in one place. The server calls
// these functions for each protected operation; the browser may call them only
// to hide controls it knows the server would refuse. Pure and framework-free so
// the Node realtime server, the Next.js app, and the tests share it.

export const ROLES = ["MEMBER", "SCOUT", "SCOUT_LEAD", "ADMIN", "ROOT"] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_STATUSES = ["active", "pending", "disabled"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

const RANK: Record<Role, number> = { MEMBER: 0, SCOUT: 1, SCOUT_LEAD: 2, ADMIN: 3, ROOT: 4 };

export const ROLE_LABELS: Record<Role, string> = { MEMBER: "Member", SCOUT: "Scout", SCOUT_LEAD: "Scout lead", ADMIN: "Admin", ROOT: "Root" };
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  MEMBER: "Reads the scouting dashboard.",
  SCOUT: "Scouts matches; reads the dashboard.",
  SCOUT_LEAD: "Approves accounts and manages members and scouts.",
  ADMIN: "Operations panel, audit log, and manages everyone below admin.",
  ROOT: "Everything, including managing admins and other root accounts.",
};

export function isRole(value: unknown): value is Role { return typeof value === "string" && (ROLES as readonly string[]).includes(value); }
export function isAccountStatus(value: unknown): value is AccountStatus { return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value); }
export function roleRank(role: Role): number { return RANK[role]; }

/**
 * Operations that need more than a signed-in account, and the lowest role that
 * may perform them. Every one also requires an `active` account.
 */
export const PERMISSIONS = {
  /** Every scouting page, the dashboard REST API, and the realtime feed. */
  "dashboard:read": "MEMBER",
  /** The user list and account details. */
  "users:read": "SCOUT_LEAD",
  /** Approve, edit, change roles, disable, revoke sessions (further limited by {@link canManageUser}). */
  "users:manage": "SCOUT_LEAD",
  /** System health, realtime/sync/API monitoring, diagnostics. */
  "ops:read": "ADMIN",
  /** Run on-demand health checks (writes one short-lived diagnostic document to the account store). */
  "ops:diagnose": "ADMIN",
  "audit:read": "ADMIN",
} as const satisfies Record<string, Role>;
export type Permission = keyof typeof PERMISSIONS;

/** What authorization decisions need to know about an account. Always loaded server-side. */
export interface Principal { id: string; role: Role; status: AccountStatus; /** Root through AUTH_ROOT_EMAILS: cannot be demoted or disabled from the app. */ rootLocked?: boolean }

export function can(principal: Principal | null | undefined, permission: Permission): boolean {
  if (!principal || principal.status !== "active") return false;
  return RANK[principal.role] >= RANK[PERMISSIONS[permission]];
}

/**
 * Whether `actor` may change anything about `target`'s account. Nobody manages
 * their own account (no self-elevation, no self-lockout), configured root
 * accounts are managed only through configuration, and otherwise only accounts
 * strictly below the actor's role, except that ROOT manages other ROOTs.
 */
export function canManageUser(actor: Principal | null | undefined, target: Principal): boolean {
  if (!actor || !can(actor, "users:manage")) return false;
  if (actor.id === target.id || target.rootLocked) return false;
  if (actor.role === "ROOT") return true;
  return RANK[target.role] < RANK[actor.role];
}

/** Roles `actor` may hand out: strictly below their own, and anything for ROOT. */
export function assignableRoles(actor: Principal | null | undefined): Role[] {
  if (!actor || !can(actor, "users:manage")) return [];
  return ROLES.filter((role) => actor.role === "ROOT" || RANK[role] < RANK[actor.role]);
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
