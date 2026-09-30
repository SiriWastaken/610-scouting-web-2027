// Real user workflows in real Chromium against the production server. Target
// agnostic: runs against the fake Sync Gateway and (in CI) a real Couchbase.
// Numbers asserted here are the hand-computed values in tests/fixtures/event-dataset.ts.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright";
import { expectedCoverage, expectedDefaultAllianceScore, expectedFuelAscending, expectedFuelDescending, eventDocuments } from "../fixtures/event-dataset.ts";
import { startAppWithAuth, type AppServer } from "../helpers/app-server.ts";
import type { TestAuth, TestUser } from "../helpers/auth.ts";
import { launchBrowser, openPage, teamOrder, waitForLive, waitForText } from "../helpers/browser.ts";
import { seedDocuments } from "../helpers/dataset.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { waitFor } from "../helpers/wait.ts";

let target: GatewayTarget;
let app: AppServer;
let auth: TestAuth;
// Dashboard pages need a signed-in, approved account; sign-in itself is covered in browser-auth-and-admin.
let member: TestUser;
let browser: Browser;

before(async () => {
  target = await startGatewayTarget();
  await seedDocuments(target, eventDocuments);
  ({ app, auth } = await startAppWithAuth({ ...target.appEnv(), TBA_API_KEY: "" }));
  member = await auth.user("MEMBER");
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await app?.stop(); await auth?.stop(); await target?.stop(); });

test("coverage page shows the hand-computed event health", async () => {
  const { page, errors } = await openPage(browser, app.base, "/coverage", member);
  await waitForText(page, (text) => /teams with aggregates/i.test(text), "coverage rendered");
  // Pages can start from the server's 20 s snapshot cache and converge live, so wait for the expected state.
  const expectedTiles = [String(expectedCoverage.teams), String(expectedCoverage.observedMatches), `${expectedCoverage.completePercent}%`];
  let tiles: string[] = [];
  await waitFor(async () => JSON.stringify(tiles = await page.locator(".font-mono.text-xl").allInnerTexts()) === JSON.stringify(expectedTiles), "coverage tiles", 15_000, () => JSON.stringify(tiles));
  for (const team of expectedCoverage.ready) assert.match(await page.locator("tr", { hasText: String(team) }).first().innerText(), /READY/);
  for (const team of expectedCoverage.check) assert.match(await page.locator("tr", { hasText: String(team) }).first().innerText(), /CHECK/);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("strategy page estimates the default alliance from the top three teams", async () => {
  const { page, errors } = await openPage(browser, app.base, "/strategy", member);
  await waitForText(page, (text) => /estimated alliance score/i.test(text), "strategy rendered");
  let score = "";
  await waitFor(async () => (score = await page.locator('[data-alliance-score="red"]').innerText()) === expectedDefaultAllianceScore, "alliance score", 15_000, () => score);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("averages board sorts by a statistic in both directions, keeping teams without data last", async () => {
  const { page } = await openPage(browser, app.base, "/averages", member);
  await waitForText(page, (text) => /5 teams indexed/i.test(text), "averages rendered");
  const header = page.getByRole("button", { name: "Sort by Fuel scored / match" });
  await header.click();
  let order: number[] = [];
  await waitFor(async () => JSON.stringify(order = await teamOrder(page)) === JSON.stringify(expectedFuelAscending), "ascending order", 15_000, () => JSON.stringify(order));
  await header.click();
  await waitFor(async () => JSON.stringify(order = await teamOrder(page)) === JSON.stringify(expectedFuelDescending), "descending order", 15_000, () => JSON.stringify(order));
  await page.context().close();
});

test("team page shows the team's statistics and nothing private", async () => {
  const { page, errors } = await openPage(browser, app.base, "/teams/610", member);
  const expectedValues = ["Crescent Coyotes", "12.5", "30.0", "10.0", "22.4", "82%", "8.5 / 10", "2.0 / 5", "10%"];
  await waitForText(page, (text) => expectedValues.every((value) => text.includes(value)), `team detail shows ${expectedValues.join(", ")}`);
  const text = await page.locator("body").innerText();
  for (const secret of ["Alex", "private note", "hunter2"]) assert.equal(text.includes(secret), false, `does not show ${secret}`);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test("scout submits a match: it persists, and both open browsers show it, its edit, and its deletion", async () => {
  const devices = await Promise.all([openPage(browser, app.base, "/teams", member), openPage(browser, app.base, "/teams", member)]);
  for (const { page } of devices) {
    await waitForLive(page);
    await waitForText(page, (text) => text.includes("3 Matches"), "team 610 match log loaded");
  }

  // Scouting tablet submits match 4 for team 610 straight to Sync Gateway.
  const rev = await target.upsert("scouting_610_4", { type: "scouting_data", team: 610, data: { start: { match: 4, alliance: "blue", position: "b1", scoutName: "Private Scout" }, teleop: { fuelscored: 47 } } });
  assert.equal((await target.read("scouting_610_4"))?._rev, rev, "the submission is persisted");
  for (const { page } of devices) await waitForText(page, (text) => text.includes("4 Matches") && /\b47\b/.test(text), "new match appears live");

  await target.upsert("scouting_610_4", { type: "scouting_data", team: 610, data: { start: { match: 4, alliance: "blue" }, teleop: { fuelscored: 52 } } });
  for (const { page } of devices) await waitForText(page, (text) => /\b52\b/.test(text) && !/\b47\b/.test(text), "edit appears live");

  await target.destroy("scouting_610_4");
  assert.equal(await target.read("scouting_610_4"), null);
  for (const { page, errors } of devices) {
    await waitForText(page, (text) => text.includes("3 Matches") && !/\b52\b/.test(text), "deletion appears live");
    assert.equal((await page.locator("body").innerText()).includes("Private Scout"), false);
    assert.deepEqual(errors, []);
    await page.context().close();
  }
});

test("an aggregate update recalculates coverage live in every open browser", async () => {
  const devices = await Promise.all([openPage(browser, app.base, "/coverage", member), openPage(browser, app.base, "/coverage", member)]);
  for (const { page } of devices) await waitForLive(page);
  // Team 971 finishes its first four matches: 37 + 4 = 41 matches; 4 of 5 teams complete = 80%.
  await target.upsert("aggregate_971", { type: "aggregate_data", team: 971, data: { standing: 5, matchesPlayed: 4, teleopFuelaccuracy: 50 } });
  for (const { page } of devices) {
    await waitForText(page, (text) => /\b41\b/.test(text) && text.includes("80%"), "coverage recalculated");
    await page.context().close();
  }
  await target.upsert("aggregate_971", eventDocuments.aggregate_971);
});

test("a team that appears after the page loaded gets its pit name, exactly as a reload would show it", async () => {
  const { page } = await openPage(browser, app.base, "/averages", member);
  await waitForLive(page);
  await target.upsert("aggregate_9999", { type: "aggregate_data", team: 9999, data: { standing: 6, matchesPlayed: 1 } });
  await waitForText(page, (text) => text.includes("No Aggregate Yet"), "new team shown with its pit name");
  const reloaded = await openPage(browser, app.base, "/averages", member);
  await waitForText(reloaded.page, (text) => text.includes("No Aggregate Yet"), "reloaded page agrees");
  await target.destroy("aggregate_9999");
  await waitForText(page, (text) => !text.includes("No Aggregate Yet"), "deleted team disappears live");
  await page.context().close(); await reloaded.page.context().close();
});

test("switching teams on the teams page shows that team's matches and card reports", async () => {
  const { page, errors } = await openPage(browser, app.base, "/teams", member);
  await waitForText(page, (text) => text.includes("3 Matches"), "loaded");
  await waitForText(page, (text) => text.includes("Yellow") && text.includes("Red") && text.includes("G204"), "610 card reports");
  assert.equal((await page.locator("body").innerText()).includes("private"), false, "report notes are not shown");
  await page.locator("select").first().selectOption("254");
  await waitForText(page, (text) => text.includes("No match data recorded yet") && text.includes("No Card Reports"), "254 has no matches or cards");
  assert.deepEqual(errors, []);
  await page.context().close();
});
