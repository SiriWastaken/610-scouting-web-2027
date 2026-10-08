#!/usr/bin/env node
// Function length: no function in the app's source is longer than 30 lines, nested functions included.
// This is the check behind docs/handbook/decisions/0008-thirty-line-functions.md. Tests are not measured.
// Exits 1 with the offenders, longest first.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");
const MAX_LINES = 30;
const SKIPPED = /^tests\/|\.d\.ts$/;

const files = execSync("git ls-files '*.ts' '*.tsx' '*.mjs'", { encoding: "utf8" }).split("\n").filter((file) => file && !SKIPPED.test(file));
const offenders = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const first = source.getLineAndCharacterOfPosition(node.getStart()).line;
      const last = source.getLineAndCharacterOfPosition(node.getEnd()).line;
      if (last - first + 1 > MAX_LINES) offenders.push({ lines: last - first + 1, where: `${file}:${first + 1}`, name: node.name?.getText() ?? "(anonymous)" });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (offenders.length) {
  offenders.sort((a, b) => b.lines - a.lines);
  console.error(`✖ Function length: ${offenders.length} function(s) over ${MAX_LINES} lines\n  ${offenders.map((o) => `${o.lines} lines  ${o.where}  ${o.name}`).join("\n  ")}\nSplit them (docs/handbook/08-how-we-build.md).`);
  process.exit(1);
}
console.log(`✔ Function length: every function in ${files.length} source files is ${MAX_LINES} lines or fewer.`);
