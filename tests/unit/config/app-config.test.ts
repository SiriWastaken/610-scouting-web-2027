import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { appConfig } from "../../../app.config.ts";

test("app config: every navigation entry opens a page that exists, and each is listed once", () => {
  const items = [...appConfig.navigation, appConfig.adminNavigation];
  for (const { href } of items) assert.ok(existsSync(`app/(app)${href}/page.tsx`), `${href} has no page`);
  assert.equal(new Set(items.map((item) => item.href)).size, items.length);
  assert.ok(appConfig.navigation.every((item) => item.description.trim().length > 0), "every page has a description");
});

test("app config: the Averages columns are unique and every column has a label", () => {
  const keys = appConfig.averagesColumns.map((column) => column.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(appConfig.averagesColumns.every((column) => column.label.trim().length > 0));
});

test("app config: analysis thresholds can actually be met", () => {
  const { lowSampleThreshold, outlierSd, outlierMedianMultiple, outlierMinField, robotsPerAlliance } = appConfig.analysis;
  assert.ok(lowSampleThreshold >= 1 && outlierSd > 0 && outlierMedianMultiple > 1 && outlierMinField >= 2 && robotsPerAlliance >= 1);
  assert.ok(Number.isInteger(appConfig.team.number) && appConfig.team.number > 0);
});
