// The signed-out → signed-in → admin journey in real Chromium against the
// production server, with the fake Google provider standing in for the real
// one (the browser follows real redirects).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright";
import { eventDocuments } from "../fixtures/event-dataset.ts";
import { startAppWithAuth, type AppServer } from "../helpers/app-server.ts";
import { CONFIGURED_OWNER, type TestAuth } from "../helpers/auth.ts";
import { launchBrowser, openPage, waitForLive, waitForText } from "../helpers/browser.ts";
import { seedDocuments } from "../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { waitFor } from "../helpers/wait.ts";

let target: GatewayTarget;
let app: AppServer;
let auth: TestAuth;
let browser: Browser;
let n = 0;

before(async () => {
  target = await startGatewayTarget();
  await seedDocuments(target, eventDocuments);
  ({ app, auth } = await startAppWithAuth({ ...target.appEnv(), TBA_API_KEY: "" }));
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await app?.stop(); await auth?.stop(); await target?.stop(); });

async function signInThroughUi(page: Page, provider: "google") {
  await page.locator(`[data-signin="${provider}"]`).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/api/"), { timeout: 20_000 });
}

test("journey: welcome screen → Google sign-in → the page asked for → account panel shows the role", async () => {
  const email = `member-${++n}@team610.test`;
  auth.oidc.setIdentity("google", { sub: `e2e-${n}`, email, emailVerified: true, name: "Mina Member" });
  const { page, errors } = await openPage(browser, app.base, "/teams/610");
  await page.waitForURL(/\/welcome\?next=%2Fteams%2F610/);
  await waitForText(page, (text) => /continue with google/i.test(text) && /610 Scouting/.test(text), "sign-in page");
  assert.equal(/apple/i.test(await page.locator("body").innerText()), false, "Google is the only sign-in option");
  // Just the sign-in card: no description of the app.
  assert.equal(/scouting data, live|strategy|averages/i.test(await page.locator("body").innerText()), false);
  await signInThroughUi(page, "google");
  assert.equal(new URL(page.url()).pathname, "/teams/610", "returned to the page they asked for");
  await waitForText(page, (text) => text.includes("Crescent Coyotes"), "team page");
  assert.equal(await page.locator("[data-account-name]").innerText(), "Mina Member", "account chip in the sidebar corner");
  assert.equal(await page.locator("[data-account-role]").getAttribute("data-account-role"), "MEMBER");
  assert.equal(await page.getByRole("link", { name: "Admin" }).count(), 0, "no admin link for members");
  await page.locator("[data-account-name]").click();
  await page.waitForURL(/\/account$/);
  await waitForText(page, (text) => text.includes(email) && /reads the scouting dashboard/i.test(text), "account panel");
  assert.equal(await page.locator("[data-profile-role]").getAttribute("data-profile-role"), "MEMBER");
  // A member cannot use the admin experience, in the UI or through the API from their browser.
  await page.goto(`${app.base}/admin`);
  await waitForText(page, (text) => /admin is for scout leads, mentors, and the owner/i.test(text), "access denied");
  const apiStatus = await page.evaluate(async () => (await fetch("/api/admin/overview")).status);
  assert.equal(apiStatus, 403);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("journey: the Owner signs in with Google, sees healthy systems, a passing WebSocket self-test, renames and promotes a user", async () => {
  auth.oidc.setIdentity("google", { sub: `owner-${++n}`, email: CONFIGURED_OWNER, emailVerified: true, name: "Olivia Owner" });
  const scout = await auth.user("SCOUT", { name: "Sam Scout" });
  const { page, errors } = await openPage(browser, app.base, "/admin");
  await page.waitForURL(/\/welcome/);
  await signInThroughUi(page, "google");
  await page.waitForURL(/\/admin$/);
  assert.equal(await page.locator("[data-account-role]").getAttribute("data-account-role"), "OWNER");
  await waitFor(async () => (await page.locator('[data-check="Sync Gateway"] [data-status]').getAttribute("data-status")) === "ok", "Sync Gateway healthy", 20_000);
  for (const card of ["API", "Couchbase", "Account store", "Authentication"]) assert.equal(await page.locator(`[data-check="${card}"] [data-status]`).getAttribute("data-status"), "ok", card);

  await page.getByRole("link", { name: "Realtime" }).click();
  await page.getByRole("button", { name: "Run WebSocket self-test" }).click();
  await waitFor(async () => (await page.locator("[data-selftest]").getAttribute("data-selftest")) === "ok", "self-test passed", 20_000);

  await page.getByRole("link", { name: "Users" }).click();
  await page.locator(`[data-user-row="${scout.email}"] a`).first().click();
  await waitForText(page, (text) => text.includes("Sam Scout") && text.includes(scout.email), "user detail");
  await page.getByLabel("Display name").fill("Sam the Scout");
  await page.getByRole("button", { name: "Save details" }).click();
  await waitForText(page, (text) => text.includes("Details saved."), "saved");
  await page.getByLabel("Role").selectOption("SCOUT_LEAD");
  await page.getByRole("button", { name: "Change role" }).click();
  await waitForText(page, (text) => /role changed from scout to scout lead/i.test(text), "role changed");
  const persisted = auth.store.docs.get(`user_${scout.userId}`)!.body!;
  assert.deepEqual({ name: persisted.displayName, role: persisted.role }, { name: "Sam the Scout", role: "SCOUT_LEAD" });

  // Promoting to MENTOR needs the typed confirmation.
  await page.getByLabel("Role").selectOption("MENTOR");
  await page.getByRole("button", { name: "Change role" }).click();
  const confirm = page.getByRole("button", { name: "Confirm" });
  assert.equal(await confirm.isDisabled(), true);
  await page.getByLabel("Type the account's email to confirm").fill(scout.email);
  await confirm.click();
  await waitFor(() => auth.store.docs.get(`user_${scout.userId}`)!.body!.role === "MENTOR", "promoted", 10_000);

  await page.getByRole("link", { name: "Audit log" }).click();
  await waitForText(page, (text) => text.includes("users.role") && text.includes(CONFIGURED_OWNER), "audit log shows the change");

  await page.getByRole("link", { name: "Diagnostics" }).click();
  await page.getByRole("button", { name: "Run full diagnostics" }).click();
  await waitFor(async () => (await page.locator('[data-question="Is data actually being persisted?"] [data-status]').getAttribute("data-status")) === "ok", "persistence verified", 20_000);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("admin health reflects a real outage: stopping answers from Sync Gateway turns the dashboard red", async () => {
  const admin = await auth.user("MENTOR");
  const { page } = await openPage(browser, app.base, "/admin", admin);
  await waitFor(async () => (await page.locator('[data-check="Sync Gateway"] [data-status]').getAttribute("data-status")) === "ok", "healthy first", 20_000);
  target.fake!.unavailable = true;
  try {
    await page.waitForTimeout(10_500); // outlive the server's 10 s health cache
    await page.getByRole("button", { name: "Refresh" }).click();
    await waitFor(async () => (await page.locator('[data-check="Sync Gateway"] [data-status]').getAttribute("data-status")) !== "ok", "outage shown", 20_000);
    assert.notEqual(await page.locator("[data-overall]").getAttribute("data-overall"), "ok");
  } finally { target.fake!.unavailable = false; }
  await page.context().close();
});

test("anyone who signs in with Google gets in; a denied account sees Access turned off; a cancelled sign-in explains itself", async () => {
  auth.oidc.setIdentity("google", { sub: `open-${++n}`, email: `new-${n}@gmail.example`, emailVerified: true, name: "Newcomer" });
  const { page } = await openPage(browser, app.base, "/welcome");
  await signInThroughUi(page, "google");
  await page.waitForURL(/\/teams/);
  await waitForText(page, (text) => text.includes("Newcomer"), "signed in straight away");
  await page.context().close();

  const denied = await auth.user("MEMBER", { name: "Dee Denied", status: "disabled" });
  auth.oidc.setIdentity("google", { sub: `sub-${denied.email}`, email: denied.email, emailVerified: true, name: "Dee Denied" });
  const blocked = await openPage(browser, app.base, "/welcome");
  await signInThroughUi(blocked.page, "google");
  await waitForText(blocked.page, (text) => /access turned off/i.test(text), "access turned off");
  await blocked.page.goto(`${app.base}/teams`);
  await blocked.page.waitForURL(/\/welcome/);
  await blocked.page.context().close();

  auth.oidc.denyNext = true;
  const cancelled = await openPage(browser, app.base, "/welcome");
  await signInThroughUi(cancelled.page, "google");
  await waitForText(cancelled.page, (text) => /sign-in was cancelled/i.test(text), "cancel message");
  await cancelled.page.context().close();
});

test("Admin → Users: Deny access signs the person out and shows them Access turned off; Allow access lets them back in", async () => {
  const member = await auth.user("MEMBER", { name: "Moe Member" });
  const mentor = await auth.user("MENTOR");
  const admin = await openPage(browser, app.base, `/admin/users/${member.userId}`, mentor);
  await waitForText(admin.page, (text) => text.includes("Moe Member"), "user page");
  await admin.page.getByRole("button", { name: "Deny access" }).click();
  await admin.page.getByLabel("Type the account's email to confirm").fill(member.email);
  await admin.page.getByRole("button", { name: "Confirm" }).click();
  await waitFor(() => auth.store.docs.get(`user_${member.userId}`)!.body!.status === "disabled", "denied", 10_000);
  await waitForText(admin.page, (text) => /signed out and cannot use the app/i.test(text), "denied note");
  // Denying ended their session, so their browser is back at sign-in; trying again explains why they can't get in.
  const locked = await openPage(browser, app.base, "/teams", member);
  await locked.page.waitForURL(/\/welcome/);
  auth.oidc.setIdentity("google", { sub: `sub-${member.email}`, email: member.email, emailVerified: true, name: "Moe Member" });
  await signInThroughUi(locked.page, "google");
  await waitForText(locked.page, (text) => /access turned off/i.test(text), "access turned off screen");
  await locked.page.context().close();
  await admin.page.getByRole("button", { name: "Allow access" }).click();
  await waitFor(() => auth.store.docs.get(`user_${member.userId}`)!.body!.status === "active", "allowed again", 10_000);
  await admin.page.context().close();
});

test("names are read-only for everyone but the Owner, on the account page and in Admin → Users", async () => {
  const mentor = await auth.user("MENTOR", { name: "Mona Mentor" });
  const scout = await auth.user("SCOUT", { name: "Stan Scout" });
  const own = await openPage(browser, app.base, "/account", mentor);
  await waitForText(own.page, (text) => text.includes("Mona Mentor") && /only the team.s owner can change names/i.test(text), "read-only names");
  assert.equal(await own.page.getByRole("button", { name: "Save changes" }).count(), 0);
  await own.page.goto(`${app.base}/admin/users/${scout.userId}`);
  await waitForText(own.page, (text) => text.includes("Stan Scout") && /only the owner can change names/i.test(text), "user page");
  assert.equal(await own.page.getByLabel("Display name").isDisabled(), true);
  assert.equal(await own.page.getByLabel("Admin note").isDisabled(), false, "mentors still keep notes");
  await own.page.context().close();
});

test("sign-out from the account chip, and a revoked session sends an open page back to the welcome screen", async () => {
  const member = await auth.user("MEMBER");
  const { page } = await openPage(browser, app.base, "/teams", member);
  await waitForLive(page);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/welcome\?signedOut=1/);
  await waitForText(page, (text) => /you're signed out/i.test(text), "signed-out notice");
  await page.goto(`${app.base}/teams`);
  await page.waitForURL(/\/welcome/);
  await page.context().close();

  const other = await auth.user("SCOUT");
  const open = await openPage(browser, app.base, "/averages", other);
  await waitForLive(open.page);
  const admin = await auth.user("MENTOR");
  const revoke = await fetch(`${app.base}/api/admin/users/${other.userId}/sessions`, { method: "DELETE", headers: { cookie: admin.cookie, origin: app.base } });
  assert.deepEqual(await revoke.json(), { revoked: 1 });
  await open.page.waitForTimeout(10_500); // the server caches sessions for 10 s per process
  await open.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await open.page.waitForURL(/\/welcome\?reason=expired/, { timeout: 15_000 });
  await waitForText(open.page, (text) => /session expired/i.test(text), "expired notice");
  await open.page.context().close();
});

test("every role gets exactly the pages its permissions allow (server-rendered, no client help)", async () => {
  const pages = ["/teams", "/account", "/admin", "/admin/users", "/admin/audit", "/admin/diagnostics"];
  // Hand-written: true = the page's own content, false = the access-denied screen.
  const expected: Record<string, boolean[]> = {
    MEMBER: [true, true, false, false, false, false],
    SCOUT: [true, true, false, false, false, false],
    SCOUT_LEAD: [true, true, true, true, false, false],
    MENTOR: [true, true, true, true, true, true],
    OWNER: [true, true, true, true, true, true],
  };
  for (const [role, allowed] of Object.entries(expected)) {
    const user = await auth.user(role as "MEMBER");
    for (const [index, path] of pages.entries()) {
      const response = await fetch(`${app.base}${path}`, { headers: { cookie: user.cookie } });
      const html = await response.text();
      const denied = /Restricted · 403/.test(html);
      assert.equal(!denied, allowed[index], `${role} ${path}`);
    }
  }
  // Signed out: every page redirects to the welcome screen with the destination remembered.
  for (const path of pages) {
    const response = await fetch(`${app.base}${path}`, { redirect: "manual" });
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get("location")!, app.base).pathname, "/welcome");
  }
  // A cookie that is not a real session still ends on the welcome screen (the page re-checks it).
  const forged = await fetch(`${app.base}/admin`, { headers: { cookie: "610_session=u00000000000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, redirect: "manual" });
  assert.equal(forged.status, 307);
  assert.match(forged.headers.get("location")!, /\/welcome\?next=%2Fadmin/);
});
