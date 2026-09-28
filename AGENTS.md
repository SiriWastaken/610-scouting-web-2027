<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Validating changes

The test bench is documented in `tests/README.md`. Run `npm run validate:fast` before and after a change, and `npm run validate` before opening a PR. A change is done only when it ends with `✔ TEST BENCH PASSED`. Never skip, focus, or delete tests, lower a floor in `scripts/test-bench/manifest.mjs`, or edit a hand-computed expectation to get a green run. New behaviour needs a test: start from `tests/testTemplate.test.ts`.
