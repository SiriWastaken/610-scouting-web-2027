#!/usr/bin/env node
// Test bench runner. Runs the named suites with node:test, then verifies from
// the recorded results (not the exit code alone) that every required file ran,
// met its test-count floor, and that nothing failed, was skipped, or was todo.
//
//   node scripts/test-bench/run.mjs unit integration security
//   node scripts/test-bench/run.mjs all
//   node scripts/test-bench/run.mjs coverage
//   node scripts/test-bench/run.mjs contract e2e --target=real
//   node scripts/test-bench/run.mjs unit --seed=12345            # reproduce an order
//   node scripts/test-bench/run.mjs unit --grep="store:"         # REPRO MODE, never a valid validation
//
// See tests/README.md.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coverage, coverageSuites, realTargetFiles, suites } from "./manifest.mjs";

const groups = {
  fast: ["unit", "integration", "security"],
  all: ["unit", "integration", "security", "contract", "stress", "e2e"],
};

const args = process.argv.slice(2);
const flag = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const target = flag("target") ?? "fake";
const grep = flag("grep");
const seed = Number(flag("seed") ?? process.env.TEST_SEED ?? Math.floor(Math.random() * 2 ** 31));
const requested = args.filter((arg) => !arg.startsWith("--"));
if (requested.length === 0) fatal("Name at least one suite: " + [...Object.keys(suites), ...Object.keys(groups), "coverage"].join(", "));
if (target !== "fake" && target !== "real") fatal(`--target must be "fake" or "real", got "${target}"`);
if (!Number.isSafeInteger(seed) || seed < 0) fatal(`--seed must be a non-negative integer`);

const outDir = ".test-bench";
mkdirSync(outDir, { recursive: true });
const problems = [];
const summary = [];

function fatal(message) { console.error(`\n✖ test bench: ${message}\n`); process.exit(1); }

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

async function checkRequirements(names) {
  const requires = new Set(names.flatMap((name) => suites[name].requires ?? []));
  if (requires.has("build") && process.env.E2E_MODE !== "dev") {
    if (!existsSync(".next/BUILD_ID")) fatal("E2E needs a production build. Run `npm run build` (npm run test:e2e does this).");
    const built = statSync(".next/BUILD_ID").mtimeMs;
    const sources = ["app", "components", "lib", "services", "types", "scripts/server.mjs"].map((path) => statSync(path).isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
    // Testing a build older than the source would validate old code.
    if (Math.max(...sources) > built) fatal("The production build is older than the source. Run `npm run build` again (npm run test:e2e does this).");
  }
  if (requires.has("chromium")) {
    const { chromium } = await import("playwright");
    if (!existsSync(chromium.executablePath())) fatal("Chromium for Playwright is not installed. Run `npx playwright install chromium` (CI: `npx playwright install --with-deps chromium`).");
  }
}

function filesFor(name) {
  const files = Object.entries(suites[name].files);
  return target === "real" ? files.filter(([file]) => realTargetFiles.has(file)) : files;
}

function runNode(label, files, { timeoutMs, serial, withCoverage }) {
  const report = join(outDir, `${label}.json`);
  const nodeArgs = [
    "--experimental-strip-types", "--no-warnings=ExperimentalWarning",
    "--import", "./tests/helpers/register-aliases.mjs",
    "--test", "--test-randomize", `--test-random-seed=${seed}`, `--test-timeout=${timeoutMs}`,
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter=./scripts/test-bench/reporter.mjs", `--test-reporter-destination=${report}`,
    ...(serial ? ["--test-concurrency=1"] : []),
    // Filtered-out files still run their before() hooks but not after(); force exit so they cannot hang.
    ...(grep ? [`--test-name-pattern=${grep}`, "--test-force-exit"] : []),
    ...(withCoverage ? [
      "--experimental-test-coverage",
      ...coverage.include.map((glob) => `--test-coverage-include=${glob}`),
      ...coverage.exclude.map((glob) => `--test-coverage-exclude=${glob}`),
    ] : []),
    ...files,
  ];
  console.log(`\n━━ ${label}: ${files.length} file(s), seed ${seed}, target ${target} ━━`);
  const started = Date.now();
  const result = spawnSync(process.execPath, nodeArgs, { stdio: "inherit", env: { ...process.env, TEST_SG_TARGET: target, TEST_SEED: String(seed) } });
  const durationMs = Date.now() - started;
  if (result.error) problems.push(`${label}: could not start node --test (${result.error.message})`);
  if (!existsSync(report)) { problems.push(`${label}: no results were recorded (the runner crashed before reporting)`); return undefined; }
  const parsed = JSON.parse(readFileSync(report, "utf8"));
  if (result.status !== 0) problems.push(`${label}: node --test exited with ${result.status ?? result.signal}`);
  return { ...parsed, durationMs };
}

function verify(label, expected, report) {
  if (!report) return;
  const byFile = new Map();
  for (const test of report.tests) {
    const entry = byFile.get(test.file) ?? { pass: 0, fail: 0, skip: 0, todo: 0 };
    if (test.skip) entry.skip += 1; else if (test.todo) entry.todo += 1; else if (test.status === "pass") entry.pass += 1; else entry.fail += 1;
    byFile.set(test.file, entry);
  }
  for (const failure of report.failures) problems.push(`${label}: FAILED ${failure.file ?? "?"} › ${failure.name}: ${failure.error.split("\n")[0]}`);
  for (const [file, min] of expected) {
    const entry = byFile.get(file) ?? { pass: 0, fail: 0, skip: 0, todo: 0 };
    summary.push({ suite: label, file, ...entry, min });
    if (grep) continue;
    if (entry.skip || entry.todo) problems.push(`${label}: ${file} skipped ${entry.skip} and marked ${entry.todo} todo; tests that do not run never count as passing`);
    if (entry.pass + entry.fail === 0) problems.push(`${label}: ${file} did not execute any tests`);
    else if (entry.pass < Math.max(min, 1)) problems.push(`${label}: ${file} passed ${entry.pass} tests, below its floor of ${min} in scripts/test-bench/manifest.mjs`);
  }
  for (const file of byFile.keys()) {
    if (file && !expected.some(([name]) => name === file)) problems.push(`${label}: unexpected results from ${file}, which is not in the manifest`);
  }
}

function verifyCoverage(report) {
  if (!report?.coverage) { problems.push("coverage: no coverage data was produced"); return; }
  const rows = [];
  for (const [file, floor] of Object.entries(coverage.files)) {
    const actual = report.coverage.files.find((entry) => entry.path === file);
    if (!actual) { problems.push(`coverage: ${file} was never loaded by the covered suites`); continue; }
    rows.push({ file, lines: actual.lines.toFixed(1), branches: actual.branches.toFixed(1), functions: actual.functions.toFixed(1), floor: `${floor.lines}/${floor.branches}/${floor.functions}` });
    for (const metric of ["lines", "branches", "functions"]) {
      if (actual[metric] + 1e-9 < floor[metric]) problems.push(`coverage: ${file} ${metric} ${actual[metric].toFixed(1)}% is below the ${floor[metric]}% floor`);
    }
  }
  console.log("\nCoverage of critical modules (lines / branches / functions %):");
  console.table(rows);
  const totals = report.coverage.totals;
  console.log(`Overall (informational): lines ${totals.coveredLinePercent.toFixed(1)}%, branches ${totals.coveredBranchPercent.toFixed(1)}%, functions ${totals.coveredFunctionPercent.toFixed(1)}%`);
}

const expanded = requested.flatMap((name) => groups[name] ?? [name]);
for (const name of expanded) if (name !== "coverage" && !suites[name]) fatal(`Unknown suite "${name}"`);
if (target === "real" && !process.env.TEST_SG_URL) fatal("--target=real needs TEST_SG_URL, TEST_SG_DATABASE, TEST_SG_USERNAME, TEST_SG_PASSWORD (see tests/README.md). It never falls back to the fake.");
await checkRequirements(expanded.filter((name) => name !== "coverage"));

for (const name of [...new Set(expanded)]) {
  if (name === "coverage") {
    const expected = coverageSuites.flatMap((suite) => filesFor(suite));
    const report = runNode("coverage", expected.map(([file]) => file), { timeoutMs: 120_000, withCoverage: true });
    verify("coverage", expected, report);
    if (!grep) verifyCoverage(report);
    continue;
  }
  const expected = filesFor(name);
  if (expected.length === 0) continue;
  const suite = suites[name];
  const label = target === "real" ? `${name}-real` : name;
  verify(label, expected, runNode(label, expected.map(([file]) => file), suite));
}

console.log("\nTest bench results (per file):");
console.table(summary.map(({ suite, file, pass, fail, skip, todo, min }) => ({ suite, file, pass, fail, skip, todo, floor: min })));
const totals = summary.reduce((sum, row) => ({ pass: sum.pass + row.pass, fail: sum.fail + row.fail }), { pass: 0, fail: 0 });
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ seed, target, grep, suites: expanded, totals, files: summary, problems }, null, 2));
console.log(`Seed ${seed} (reproduce the order with --seed=${seed}). ${totals.pass} passed, ${totals.fail} failed.`);
if (grep) {
  console.log("\n⚠ REPRO MODE (--grep): tests were filtered by name, so this run can never count as validation.");
  process.exit(problems.length ? 1 : 3);
}
if (problems.length) {
  console.error(`\n✖ TEST BENCH FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`\n✔ TEST BENCH PASSED: ${expanded.join(", ")}`);
