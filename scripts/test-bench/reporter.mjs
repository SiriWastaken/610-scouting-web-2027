// node:test reporter that records every test outcome (and coverage, when
// enabled) as JSON, so the bench can prove what actually executed instead of
// trusting an exit code.
import { relative } from "node:path";

const rel = (file) => (file ? relative(process.cwd(), file.startsWith("file:") ? new URL(file).pathname : file) : undefined);

/** Records one finished test (or a failed suite) into `tests` / `failures`. */
function recordResult(event, tests, failures) {
  const data = event.data;
  const failed = event.type === "test:fail";
  if (data.details?.type === "suite") {
    if (failed) failures.push({ file: rel(data.file), name: data.name, error: String(data.details?.error?.message ?? data.details?.error ?? "suite failed") });
    return;
  }
  tests.push({
    file: rel(data.file),
    name: data.name,
    nesting: data.nesting,
    status: failed ? "fail" : "pass",
    skip: data.skip !== undefined && data.skip !== false,
    todo: data.todo !== undefined && data.todo !== false,
    durationMs: data.details?.duration_ms,
  });
  if (failed) failures.push({ file: rel(data.file), name: data.name, error: String(data.details?.error?.cause?.message ?? data.details?.error?.message ?? "failed") });
}

const summarizeCoverage = ({ totals, files }) => ({
  totals,
  files: files.map((file) => ({ path: rel(file.path), lines: file.coveredLinePercent, branches: file.coveredBranchPercent, functions: file.coveredFunctionPercent })),
});

export default async function* benchReporter(source) {
  const tests = [];
  const failures = [];
  let coverage;
  for await (const event of source) {
    if (event.type === "test:pass" || event.type === "test:fail") recordResult(event, tests, failures);
    else if (event.type === "test:coverage") coverage = summarizeCoverage(event.data.summary);
  }
  yield `${JSON.stringify({ tests, failures, coverage }, null, 2)}\n`;
}
