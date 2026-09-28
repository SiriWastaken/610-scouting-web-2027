#!/usr/bin/env node
// Static checks that stop tests from being switched off quietly:
//  - no .skip / .only / .todo, `{ skip | only | todo: ... }`, or t.skip() in tests
//  - every test file on disk is in the manifest, and every manifest file exists
//  - no package script or CI step filters, skips, or ignores test results
//  - the CI workflow still runs every required suite
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { suites } from "./manifest.mjs";

const problems = [];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

const disablers = [
  [/\b(?:test|it|describe|suite)\s*\.\s*(?:skip|only|todo)\b/, "a skipped, focused, or todo test"],
  [/\b(?:skip|only|todo)\s*:\s*(?!false\b)[^,}\s]/, "a skip/only/todo test option"],
  [/\b(?:t|context|ctx)\s*\.\s*(?:skip|todo|runOnly)\s*\(/, "a runtime skip"],
  [/\bprocess\s*\.\s*exit\s*\(/, "process.exit in a test (ends the run before results are reported)"],
];
const testSources = walk("tests").filter((file) => /\.(?:ts|mjs|js)$/.test(file));
for (const file of testSources) {
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    if (/^\s*\/\//.test(line)) return;
    for (const [pattern, description] of disablers) {
      if (pattern.test(line)) problems.push(`${file}:${index + 1}: ${description}: ${line.trim()}`);
    }
  });
}

const listed = new Set(Object.values(suites).flatMap((suite) => Object.keys(suite.files)));
for (const file of testSources.filter((name) => name.endsWith(".test.ts"))) {
  if (!listed.has(file)) problems.push(`${file} is not listed in scripts/test-bench/manifest.mjs, so it would never run`);
}
for (const file of listed) if (!existsSync(file)) problems.push(`manifest lists ${file}, which does not exist`);

const forbiddenFlags = /--test-only|--test-skip-pattern|--test-name-pattern|--grep|--passWithNoTests|\|\|\s*true|;\s*true\b|continue-on-error:\s*true/;
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
  if (forbiddenFlags.test(script)) problems.push(`package.json script "${name}" filters or ignores test results: ${script}`);
}

const workflowPath = ".github/workflows/ci.yml";
if (!existsSync(workflowPath)) problems.push(`${workflowPath} is missing`);
else {
  const workflow = readFileSync(workflowPath, "utf8");
  if (forbiddenFlags.test(workflow)) problems.push(`${workflowPath} filters or ignores test results`);
  const required = ["npm run lint", "npm run typecheck", "npm run test:hygiene", "npm run test:unit", "npm run test:integration", "npm run test:security", "npm run test:contract", "npm run test:coverage", "npm run build", "npm run test:e2e:prebuilt", "npm run test:stress", "npm run test:real"];
  for (const command of required) if (!workflow.includes(command)) problems.push(`${workflowPath} no longer runs \`${command}\``);
  if (!/pull_request:\s*\n\s*branches:\s*\[\s*main\s*\]/.test(workflow)) problems.push(`${workflowPath} must run on pull requests targeting main`);
}

if (problems.length) {
  console.error(`✖ Test hygiene failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`✔ Test hygiene: ${testSources.length} test sources checked, ${listed.size} manifest files present, no disabled tests, CI runs every suite.`);
