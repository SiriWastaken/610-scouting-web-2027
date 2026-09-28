// The role model: every permission for every role and account status, and the
// rules for who may manage whom. Expected tables are written out by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_SECTIONS, assignableRoles, can, canAssignRole, canManageUser, canOpenAdmin, PERMISSIONS, ROLES, type Permission, type Principal, type Role } from "../../../lib/auth/roles.ts";

const who = (role: Role, status: Principal["status"] = "active", id = `u-${role}`, rootLocked = false): Principal => ({ id, role, status, rootLocked });

test("roles: exactly the planned five, lowest to highest", () => {
  assert.deepEqual([...ROLES], ["MEMBER", "SCOUT", "SCOUT_LEAD", "ADMIN", "ROOT"]);
});

test("permissions: hand-written matrix for every active role", () => {
  const expected: Record<Permission, Role[]> = {
    "dashboard:read": ["MEMBER", "SCOUT", "SCOUT_LEAD", "ADMIN", "ROOT"],
    "users:read": ["SCOUT_LEAD", "ADMIN", "ROOT"],
    "users:manage": ["SCOUT_LEAD", "ADMIN", "ROOT"],
    "ops:read": ["ADMIN", "ROOT"],
    "ops:diagnose": ["ADMIN", "ROOT"],
    "audit:read": ["ADMIN", "ROOT"],
  };
  assert.deepEqual(Object.keys(PERMISSIONS).sort(), Object.keys(expected).sort(), "every permission is in this table");
  for (const [permission, roles] of Object.entries(expected) as Array<[Permission, Role[]]>) {
    for (const role of ROLES) assert.equal(can(who(role), permission), roles.includes(role), `${role} ${permission}`);
  }
});

test("permissions: pending and disabled accounts can do nothing, whatever their role; no principal can do nothing", () => {
  for (const status of ["pending", "disabled"] as const) {
    for (const role of ROLES) for (const permission of Object.keys(PERMISSIONS) as Permission[]) assert.equal(can(who(role, status), permission), false, `${status} ${role} ${permission}`);
  }
  assert.equal(can(null, "dashboard:read"), false);
  assert.equal(can(undefined, "dashboard:read"), false);
});

test("management: strictly lower roles only, ROOT manages ROOT, nobody manages themselves", () => {
  // actor -> roles of other accounts they may manage
  const expected: Record<Role, Role[]> = {
    MEMBER: [], SCOUT: [],
    SCOUT_LEAD: ["MEMBER", "SCOUT"],
    ADMIN: ["MEMBER", "SCOUT", "SCOUT_LEAD"],
    ROOT: ["MEMBER", "SCOUT", "SCOUT_LEAD", "ADMIN", "ROOT"],
  };
  for (const actor of ROLES) for (const target of ROLES) {
    assert.equal(canManageUser(who(actor), who(target, "active", "someone-else")), expected[actor].includes(target), `${actor} manages ${target}`);
  }
  for (const role of ROLES) assert.equal(canManageUser(who(role, "active", "same"), who(role, "active", "same")), false, `${role} cannot manage self`);
  assert.equal(canManageUser(who("ROOT"), who("ROOT", "active", "configured", true)), false, "configured roots are managed only by configuration");
  assert.equal(canManageUser(who("ADMIN", "disabled"), who("MEMBER", "active", "x")), false, "a disabled admin manages nobody");
});

test("role grants: below your own role; ROOT may grant anything", () => {
  assert.deepEqual(assignableRoles(who("MEMBER")), []);
  assert.deepEqual(assignableRoles(who("SCOUT")), []);
  assert.deepEqual(assignableRoles(who("SCOUT_LEAD")), ["MEMBER", "SCOUT"]);
  assert.deepEqual(assignableRoles(who("ADMIN")), ["MEMBER", "SCOUT", "SCOUT_LEAD"]);
  assert.deepEqual(assignableRoles(who("ROOT")), ["MEMBER", "SCOUT", "SCOUT_LEAD", "ADMIN", "ROOT"]);
  assert.equal(canAssignRole(who("ADMIN"), who("SCOUT", "active", "t"), "ADMIN"), false, "an admin cannot make another admin");
  assert.equal(canAssignRole(who("ADMIN"), who("SCOUT", "active", "t"), "SCOUT_LEAD"), true);
  assert.equal(canAssignRole(who("SCOUT_LEAD"), who("MEMBER", "pending", "t"), "SCOUT"), true, "leads promote pending members to scouts");
  assert.equal(canAssignRole(who("SCOUT_LEAD"), who("SCOUT", "active", "t"), "SCOUT_LEAD"), false);
  assert.equal(canAssignRole(who("ADMIN", "active", "a"), who("ADMIN", "active", "a"), "ROOT"), false, "no self-elevation");
});

test("admin area: who sees which sections", () => {
  const visible = (role: Role) => ADMIN_SECTIONS.filter((section) => can(who(role), section.permission)).map((section) => section.label);
  assert.deepEqual(visible("MEMBER"), []);
  assert.deepEqual(visible("SCOUT"), []);
  assert.deepEqual(visible("SCOUT_LEAD"), ["Users"]);
  assert.deepEqual(visible("ADMIN"), ["Overview", "Realtime", "Sync", "API", "Users", "Audit log", "Diagnostics"]);
  assert.equal(canOpenAdmin(who("SCOUT")), false);
  assert.equal(canOpenAdmin(who("SCOUT_LEAD")), true);
  assert.equal(canOpenAdmin(who("ROOT", "pending")), false);
});
