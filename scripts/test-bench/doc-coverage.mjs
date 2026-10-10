#!/usr/bin/env node
// Documentation coverage. Code: every source file starts with a comment saying what it is for, and every exported
// function, class, type and constant has a doc comment (route, page and layout files need only the header, because
// their exports are framework settings and handlers named by Next.js). Docs: every page has frontmatter with a
// title, description, verified_at and sources; every `sources` path exists; every [[link]] names a real page;
// the pages in docs/ are numbered 00, 01, 02… in reading order with a matching title, heading and navigation line,
// and 00-preface lists them all.
// This is the check behind the rules in docs/19-how-we-document.md. Exits 1 with a list when it fails.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");

/** Config files whose exports are fixed by their tools. */
const SKIPPED = /(^|\/)(eslint|postcss|next)\.config\.(mjs|ts)$|\.d\.ts$|^tests\/|^scripts\/test-infra\//;
/** Files documented by their header alone. */
const FRAMEWORK_FILE = /(^|\/)(page|layout|route)\.tsx?$|^(proxy|instrumentation)\.ts$/;
const DECLARATIONS = [ts.isFunctionDeclaration, ts.isClassDeclaration, ts.isInterfaceDeclaration, ts.isTypeAliasDeclaration, ts.isVariableStatement];

const files = execSync("git ls-files --cached --others --exclude-standard '*.ts' '*.tsx' '*.mjs'", { encoding: "utf8" }).split("\n").filter((file) => file && !SKIPPED.test(file));

/** Whether the text starts with a comment, ignoring a shebang and a leading directive such as "use client". */
function hasHeader(text) {
  const body = text.replace(/^#!.*\n/, "").trimStart().replace(/^(["']use client["'];?|import ["']server-only["'];?)\s*/, "");
  return body.startsWith("//") || body.startsWith("/*") || /^\s*(\/\/|\/\*)/.test(text.replace(/^#!.*\n/, "").trimStart());
}

function undocumentedExports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const missing = [];
  for (const statement of source.statements) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (!exported || isDefault || !DECLARATIONS.some((test) => test(statement))) continue;
    const comments = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? [];
    if (comments.some((range) => /^\/(\*\*|\/)/.test(text.slice(range.pos, range.end)))) continue;
    missing.push(statement.name?.getText() ?? statement.declarationList.declarations[0].name.getText());
  }
  return missing;
}

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!hasHeader(text)) problems.push(`${file}: no header comment saying what the file is for`);
  if (FRAMEWORK_FILE.test(file)) continue;
  const missing = undocumentedExports(file, text);
  for (const name of missing) problems.push(`${file}: exported \`${name}\` has no doc comment`);
}

/** Frontmatter, `sources` paths and `[[wiki links]]` of every page under docs/ (the page template is skipped). */
function docProblems() {
  const pages = execSync("git ls-files --cached --others --exclude-standard 'docs/*.md' 'docs/**/*.md'", { encoding: "utf8" }).split("\n").filter((file) => file && !basename(file).startsWith("_"));
  const names = new Set(pages.map((file) => basename(file, ".md")));
  const found = [];
  for (const page of pages) {
    const text = readFileSync(page, "utf8");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    for (const key of ["title", "description", "verified_at", "sources"]) if (!new RegExp(`^${key}:`, "m").test(front)) found.push(`${page}: frontmatter is missing \`${key}\``);
    for (const [, path] of front.matchAll(/^\s+- (.+)$/gm)) if (!existsSync(path.trim())) found.push(`${page}: source \`${path.trim()}\` does not exist`);
    const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    for (const [, target] of prose.matchAll(/\[\[([^\]|#]+)/g)) if (!names.has(target.trim())) found.push(`${page}: link [[${target.trim()}]] names no page`);
  }
  return [...found, ...numberingProblems(pages)];
}

/** `docs/NN-name.md` pages (docs/CLAUDE.md and docs/decisions/ are exempt): contiguous numbers, matching title and heading, a nav line, listed in the preface. */
function numberingProblems(pages) {
  const found = [];
  const numbered = pages.filter((page) => /^docs\/[^/]+\.md$/.test(page) && basename(page) !== "CLAUDE.md").sort();
  numbered.forEach((page, index) => {
    const name = basename(page, ".md");
    const wanted = String(index).padStart(2, "0");
    if (!name.startsWith(`${wanted}-`)) { found.push(`${page}: expected a name starting \`${wanted}-\` (numbers run 00, 01, 02… with none skipped or repeated)`); return; }
    const text = readFileSync(page, "utf8");
    const title = /^title: (.*)$/m.exec(text)?.[1]?.trim() ?? "";
    const heading = /^# (.*)$/m.exec(text)?.[1]?.trim() ?? "";
    if (!title.startsWith(`${wanted} - `)) found.push(`${page}: title must start with "${wanted} - "`);
    if (heading !== title) found.push(`${page}: the first heading must equal the title ("${title}")`);
    if (!/\*\*(Contents|Start reading):\*\*/.test(text)) found.push(`${page}: no Previous / Contents / Next line under the heading`);
    if (index > 0 && !readFileSync("docs/00-preface.md", "utf8").includes(`[[${name}]]`)) found.push(`${page}: not listed in the contents table of 00-preface`);
  });
  return found;
}
problems.push(...docProblems());

if (problems.length) {
  console.error(`✖ Documentation coverage: ${problems.length} gap(s)\n  ${problems.join("\n  ")}\nSee docs/19-how-we-document.md.`);
  process.exit(1);
}
console.log(`✔ Documentation coverage: ${files.length} source files have a header and every export is documented, and every docs page has frontmatter and working links.`);
