---
title: 18 - DEVELOPMENT GUIDE
description: Setup, commands, conventions, and recipes for common changes
verified_at: 7c5884e (2026-10-08)
sources:
  - package.json
  - scripts/test-bench/run.mjs
  - tests/README.md
  - .githooks/pre-push
  - .env.example
  - eslint.config.mjs
---

# 18 - DEVELOPMENT GUIDE

**Previous:** [[17-how-we-build]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[19-how-we-document]]

## Setup

```bash
nvm use && npm ci
cp .env.example .env.local   # then fill in the AUTH_* and COUCHBASE_* values
npm run dev                  # http://localhost:3000
```

No credentials? Use the fake account store and fake Sync Gateway: [[10-authentication]] (Local development) and the end of `README.md`.

## Validating

`npm run validate:fast` before and after a change; `npm run validate` before a PR. Done means it ends with
`✔ TEST BENCH PASSED`. It also runs two source checks: `npm run test:docs` (every file has a header comment, every export a doc comment) and `npm run test:size` (no function over 30 lines). Never skip, focus or delete tests, lower a floor in `scripts/test-bench/manifest.mjs`, or edit a
hand-computed expectation to get green. New behaviour needs a test: copy `tests/testTemplate.test.ts`. Full guide: [`tests/README.md`](../tests/README.md).

`npm run typecheck` reads `.next/dev/types`, which a running dev server rewrites. If it reports syntax errors in
`.next/dev/types/*`, stop the dev server and run it again.

## Conventions

- Routes stay thin; logic goes in `lib/`, I/O in `services/`, UI in `components/`.
- Logic with a noun in it (team, match, alliance, event) goes on the class in `lib/domain/`; pure arithmetic stays in `lib/data/team-stats.ts`; settings that change per season go in `app.config.ts` ([[08-configuration]]).
- No function over 30 lines. Every file starts with a comment on what it is for; every export has a doc comment ([[19-how-we-document]]).
- In `lib/` and `scripts/` (run directly by Node): no constructor parameter properties and no enums.
- One component per concern; split a file when it passes a few hundred lines (see `components/dashboard/teams/`).
- Parse untrusted documents with the sanitizers in `lib/data/`; never render raw document values.
- Server-only modules import `"server-only"`; client components start with `'use client'`.
- Use `@/` imports for app code. Modules shared with plain Node (protocol, stats, tests) use relative `.ts` imports.
- Colours and spacing come from tokens ([[14-design-system]]).
- Comments explain *why*, not what. The reasons behind these conventions are in [[17-how-we-build]].

## Recipes

**Add a dashboard page:** create `app/(app)/<name>/page.tsx` using `LivePage` (copy `coverage/page.tsx`: a few lines); add an entry to `navigation` in `app.config.ts` with its label, icon name and description (a new icon name also goes in `NavIcon` and the map in `components/layout/nav-links.tsx`); add a test; update [[13-pages]]. `tests/unit/config/app-config.test.ts` fails if the entry has no page.

**Add an API route:** `app/api/<name>/route.ts`, start with `guard(request, { permission, action })`; validate every input;
add a case to `tests/security/authorization-matrix.test.ts`.

**Add a scouted statistic:** map the raw field in `normalizeAggregateDocument`, add it to `TeamAggregate`, add the key to the allow-list in
`lib/realtime/protocol.ts` only if it is safe to show to everyone, add its raw field names to `RAW_FIELDS` in `lib/domain/team.ts` so `Team.statValue` returns `null` for missing data, and update [[05-data-model]] and [[06-the-objects]].

**Change roles or permissions:** only in `lib/auth/roles.ts`; update the matrix test and [[10-authentication]].
