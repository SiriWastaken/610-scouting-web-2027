---
title: Development guide
description: Setup, commands, conventions, and recipes for common changes
verified_at: 27726e0 (2026-10-02)
sources:
  - package.json
  - scripts/test-bench/run.mjs
  - tests/README.md
  - .githooks/pre-push
  - .env.example
  - eslint.config.mjs
---

# Development guide

## Setup

```bash
nvm use && npm ci
cp .env.example .env.local   # then fill in the AUTH_* and COUCHBASE_* values
npm run dev                  # http://localhost:3000
```

No credentials? Use the fake account store and fake Sync Gateway: [[authentication]] (Local development) and the end of `README.md`.

## Validating

`npm run validate:fast` before and after a change; `npm run validate` before a PR. Done means it ends with
`✔ TEST BENCH PASSED`. Never skip, focus or delete tests, lower a floor in `scripts/test-bench/manifest.mjs`, or edit a
hand-computed expectation to get green. New behaviour needs a test: copy `tests/testTemplate.test.ts`. Full guide: [`tests/README.md`](../tests/README.md).

`npm run typecheck` reads `.next/dev/types`, which a running dev server rewrites. If it reports syntax errors in
`.next/dev/types/*`, stop the dev server and run it again.

## Conventions

- Routes stay thin; logic goes in `lib/`, I/O in `services/`, UI in `components/`.
- One component per concern; split a file when it passes a few hundred lines (see `components/dashboard/teams/`).
- Parse untrusted documents with the sanitizers in `lib/data/`; never render raw document values.
- Server-only modules import `"server-only"`; client components start with `'use client'`.
- Use `@/` imports for app code. Modules shared with plain Node (protocol, stats, tests) use relative `.ts` imports.
- Colours and spacing come from tokens ([[design-system]]).
- Comments explain *why*, not what.

## Recipes

**Add a dashboard page:** create `app/(app)/<name>/page.tsx` (copy `box-plot/page.tsx`: `connection()`, `requirePage`, snapshot,
`PageHeader`); add a tab to `lib/ui/tabs.ts`, the CSS hue, and `navigation`; add a test; update [[pages]].

**Add an API route:** `app/api/<name>/route.ts`, start with `guard(request, { permission, action })`; validate every input;
add a case to `tests/security/authorization-matrix.test.ts`.

**Add a scouted statistic:** map the raw field in `normalizeAggregateDocument`, add it to `TeamAggregate`, add the key to the allow-list in
`lib/realtime/protocol.ts` only if it is safe to show to everyone, use `statValue` for missing data, and update [[data-model]].

**Change roles or permissions:** only in `lib/auth/roles.ts`; update the matrix test and [[authentication]].
