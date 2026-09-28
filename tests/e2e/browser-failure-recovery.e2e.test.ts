// How an open dashboard behaves when things break, in real Chromium. Needs the
// fake Sync Gateway's fault injection, so it runs only against the fake.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright";
import { eventDocuments } from "../fixtures/event-dataset.ts";
import { startAppServer, type AppServer } from "../helpers/app-server.ts";
import { launchBrowser, liveStatus, openPage, waitForLive, waitForText } from "../helpers/browser.ts";
import { seedDocuments } from "../helpers/dataset.ts";
import type { FakeSyncGateway } from "../helpers/fake-sync-gateway.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";
import { waitFor } from "../helpers/wait.ts";

let target: GatewayTarget;
let gateway: FakeSyncGateway;
let app: AppServer;
let browser: Browser;

before(async () => {
  target = await startGatewayTarget();
  assert.ok(target.fake, "fault injection needs the fake gateway");
  gateway = target.fake;
  await seedDocuments(target, eventDocuments);
  app = await startAppServer({ ...target.appEnv(), TBA_API_KEY: "" });
  browser = await launchBrowser();
});
after(async () => { await browser?.close(); await app?.stop(); await target?.stop(); });

test("database outage: the page says it is reconnecting, recovers by itself, and shows what changed meanwhile", async () => {
  const { page, errors } = await openPage(browser, app.base, "/teams");
  await waitForLive(page);
  await waitForText(page, (text) => text.includes("3 Matches"), "loaded");
  gateway.fail(503, 3);
  gateway.put("pit_1", { type: "pit", data: { teamName: "wakes the long-poll" } });
  await waitFor(async () => (await liveStatus(page)) === "reconnecting", "status shows reconnecting", 10_000);
  await waitForText(page, (text) => /reconnecting/i.test(text), "the user can see the connection problem");
  await target.upsert("scouting_610_5", { type: "scouting_data", team: 610, data: { start: { match: 5 }, teleop: { fuelscored: 61 } } });
  await waitForLive(page, 30_000);
  await waitForText(page, (text) => text.includes("4 Matches") && /\b61\b/.test(text), "change made during the outage appears");
  assert.deepEqual(errors, []);
  await page.context().close();
  await target.destroy("scouting_610_5");
});

test("server restart: an open page reconnects and catches up without a reload", async () => {
  const { page, errors } = await openPage(browser, app.base, "/coverage");
  await waitForLive(page);
  await waitForText(page, (text) => text.includes("60%"), "loaded");
  const navigations: string[] = [];
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await app.stop();
  await waitFor(async () => (await liveStatus(page)) === "reconnecting", "page noticed the server went away", 15_000);
  await target.upsert("aggregate_971", { type: "aggregate_data", team: 971, data: { standing: 5, matchesPlayed: 4, teleopFuelaccuracy: 50 } });
  await app.restart();
  await waitForLive(page, 60_000);
  await waitForText(page, (text) => text.includes("80%") && /\b41\b/.test(text), "change made while the server was down appears", 30_000);
  assert.deepEqual(navigations, [], "recovered in place, without reloading the page");
  assert.deepEqual(errors, []);
  await page.context().close();
  await target.upsert("aggregate_971", eventDocuments.aggregate_971);
});

test("malformed scouting documents in the database do not break the team page", async () => {
  await target.upsert("scouting_610_6", { type: "scouting_data", team: 610, data: { start: { match: "six", alliance: 42 }, auto: { markers: [[1, 2], { x: "a" }, null], paths: [7, null, "M 0 0 L nope"], fuelScored: "many" }, teleop: { fuelscored: { value: 3 }, breakSeverity: ["bad"] } } });
  await target.upsert("scouting_610_7", { type: "scouting_data", team: 610, data: { auto: "not an object", teleop: null, start: [] } });
  const { page, errors } = await openPage(browser, app.base, "/teams");
  await waitForText(page, (text) => /Match Performance Log/i.test(text), "match log rendered");
  const text = await page.locator("body").innerText();
  assert.equal(/application error|unhandled runtime error/i.test(text), false, "no crash screen");
  assert.deepEqual(errors, [], "no uncaught errors in the page");
  await page.context().close();
  await target.destroy("scouting_610_6"); await target.destroy("scouting_610_7");
});
