// node:test reporter that records every test outcome (and coverage, when
// enabled) as JSON, so the bench can prove what actually executed instead of
// trusting an exit code.
import { relative } from "node:path";

const rel = (file) => (file ? relative(process.cwd(), file.startsWith("file:") ? new URL(file).pathname : file) : undefined);

export default async function* benchReporter(source) {
  const tests = [];
  const failures = [];
  let coverage;
  for await (const event of source) {
    if (event.type === "test:pass" || event.type === "test:fail") {
      const data = event.data;
      if (data.details?.type === "suite") {
        if (event.type === "test:fail") failures.push({ file: rel(data.file), name: data.name, error: String(data.details?.error?.message ?? data.details?.error ?? "suite failed") });
        continue;
      }
      tests.push({
        file: rel(data.file),
        name: data.name,
        nesting: data.nesting,
        status: event.type === "test:pass" ? "pass" : "fail",
        skip: data.skip !== undefined && data.skip !== false,
        todo: data.todo !== undefined && data.todo !== false,
        durationMs: data.details?.duration_ms,
      });
      if (event.type === "test:fail") failures.push({ file: rel(data.file), name: data.name, error: String(data.details?.error?.cause?.message ?? data.details?.error?.message ?? "failed") });
    } else if (event.type === "test:coverage") {
      coverage = {
        totals: event.data.summary.totals,
        files: event.data.summary.files.map((file) => ({
          path: rel(file.path),
          lines: file.coveredLinePercent,
          branches: file.coveredBranchPercent,
          functions: file.coveredFunctionPercent,
        })),
      };
    }
  }
  yield `${JSON.stringify({ tests, failures, coverage }, null, 2)}\n`;
}
