// The role model: every permission for every role and account status, and the
// rules for who may manage whom. Expected tables are written out by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_SECTIONS, assignableRoles, can, canAssignRole, canManageUser, canOpenAdmin, PERMISSIONS, ROLES, roleRank, storedRole, type Permission, type Principal, type Role } from "../../../lib/auth/roles.ts";

const who = (role: Role, status: Principal["status"] = "active", id = `u-${role}`): Principal => ({ id, role, status });

test("roles: Owner at the top, four assignable levels below", () => {
  assert.deepEqual([...ROLES], ["MEMBER", "SCOUT", "SCOUT_LEAD", "MENTOR", "OWNER"]);
  assert.deepEqual(ROLES.map(roleRank), [0, 1, 2, 3, 4], "rank follows that order (the admin UI compares ranks)");
});

test("permissions: hand-written matrix for every active role", () => {
  const expected: Record<Permission, Role[]> = {
    "dashboard:read": ["MEMBER", "SCOUT", "SCOUT_LEAD", "MENTOR", "OWNER"],
    "users:read": ["SCOUT_LEAD", "MENTOR", "OWNER"],
    "users:manage": ["SCOUT_LEAD", "MENTOR", "OWNER"],
    "users:rename": ["OWNER"],
    "ops:read": ["MENTOR", "OWNER"],
    "ops:diagnose": ["MENTOR", "OWNER"],
    "audit:read": ["MENTOR", "OWNER"],
  };
  assert.deepEqual(Object.keys(PERMISSIONS).sort(), Object.keys(expected).sort(), "every permission is in this table");
  for (const [permission, roles] of Object.entries(expected) as Array<[Permission, Role[]]>) {
    for (const role of ROLES) assert.equal(can(who(role), permission), roles.includes(role), `${role} ${permission}`);
  }
});

test("permissions: pending and disabled accounts can do nothing; the Owner bypasses every check", () => {
  for (const status of ["pending", "disabled"] as const) {
    for (const role of ROLES.filter((value) => value !== "OWNER")) for (const permission of Object.keys(PERMISSIONS) as Permission[]) assert.equal(can(who(role, status), permission), false, `${status} ${role} ${permission}`);
  }
  for (const permission of Object.keys(PERMISSIONS) as Permission[]) assert.equal(can(who("OWNER", "pending"), permission), true, `Owner ${permission}`);
  assert.equal(can(null, "dashboard:read"), false);
  assert.equal(can(undefined, "dashboard:read"), false);
});

test("management: strictly lower roles only; nobody manages themselves or an Owner", () => {
  // actor -> roles of other accounts they may manage
  const expected: Record<Role, Role[]> = {
    MEMBER: [], SCOUT: [],
    SCOUT_LEAD: ["MEMBER", "SCOUT"],
    MENTOR: ["MEMBER", "SCOUT", "SCOUT_LEAD"],
    OWNER: ["MEMBER", "SCOUT", "SCOUT_LEAD", "MENTOR"],
  };
  for (const actor of ROLES) for (const target of ROLES) {
    assert.equal(canManageUser(who(actor), who(target, "active", "someone-else")), expected[actor].includes(target), `${actor} manages ${target}`);
  }
  for (const role of ROLES) assert.equal(canManageUser(who(role, "active", "same"), who(role, "active", "same")), false, `${role} cannot manage self`);
  assert.equal(canManageUser(who("MENTOR", "disabled"), who("MEMBER", "active", "x")), false, "a disabled mentor manages nobody");
});

test("role grants: below your own role, and OWNER is never grantable", () => {
  assert.deepEqual(assignableRoles(who("MEMBER")), []);
  assert.deepEqual(assignableRoles(who("SCOUT")), []);
  assert.deepEqual(assignableRoles(who("SCOUT_LEAD")), ["MEMBER", "SCOUT"]);
  assert.deepEqual(assignableRoles(who("MENTOR")), ["MEMBER", "SCOUT", "SCOUT_LEAD"]);
  assert.deepEqual(assignableRoles(who("OWNER")), ["MEMBER", "SCOUT", "SCOUT_LEAD", "MENTOR"]);
  assert.equal(canAssignRole(who("MENTOR"), who("SCOUT", "active", "t"), "MENTOR"), false, "a mentor cannot make another mentor");
  assert.equal(canAssignRole(who("OWNER"), who("SCOUT", "active", "t"), "MENTOR"), true, "only the Owner makes mentors");
  assert.equal(canAssignRole(who("OWNER"), who("SCOUT", "active", "t"), "OWNER"), false, "ownership is configuration, not a grant");
  assert.equal(canAssignRole(who("SCOUT_LEAD"), who("MEMBER", "pending", "t"), "SCOUT"), true, "leads promote pending members to scouts");
  assert.equal(canAssignRole(who("MENTOR", "active", "a"), who("MENTOR", "active", "a"), "OWNER"), false, "no self-elevation");
});

test("stored roles: older ADMIN/ROOT values and a stored OWNER read as MENTOR; junk reads as MEMBER", () => {
  assert.equal(storedRole("ADMIN"), "MENTOR");
  assert.equal(storedRole("ROOT"), "MENTOR");
  assert.equal(storedRole("OWNER"), "MENTOR", "ownership never comes from the database");
  assert.equal(storedRole("SCOUT_LEAD"), "SCOUT_LEAD");
  assert.equal(storedRole("superuser"), "MEMBER");
  assert.equal(storedRole(undefined), "MEMBER");
});

test("admin area: who sees which sections", () => {
  const visible = (role: Role) => ADMIN_SECTIONS.filter((section) => can(who(role), section.permission)).map((section) => section.label);
  assert.deepEqual(visible("MEMBER"), []);
  assert.deepEqual(visible("SCOUT"), []);
  assert.deepEqual(visible("SCOUT_LEAD"), ["Users"]);
  assert.deepEqual(visible("MENTOR"), ["Overview", "Realtime", "Sync", "API", "Users", "Audit log", "Diagnostics"]);
  assert.deepEqual(visible("OWNER"), visible("MENTOR"));
  assert.equal(canOpenAdmin(who("SCOUT")), false);
  assert.equal(canOpenAdmin(who("SCOUT_LEAD")), true);
  assert.equal(canOpenAdmin(who("MENTOR", "pending")), false);
});
