---
title: 0006 Node type stripping in lib and scripts
description: Files in lib/ and scripts/ run directly in Node, so TypeScript-only runtime syntax is not allowed there
verified_at: 6c13ac9 (2026-10-08)
sources:
  - package.json
  - scripts/server.mjs
  - tests/helpers/register-aliases.mjs
---

# 0006. Node type stripping in `lib/` and `scripts/`

**Status:** accepted  **Date:** 2026-10-08  **Decided by:** discovered during the cleanup; consistent with how `dev`, `start` and the tests already work

## Context

The WebSocket server (`scripts/server.mjs`) and the test bench load files from `lib/` directly with `node --experimental-strip-types`,
which erases type annotations but cannot compile TypeScript features that need code generation. Next.js's own compiler can, so a file
can pass `tsc` and `next build` and still fail to load in Node.

## Decision

In `lib/` and `scripts/`: no constructor parameter properties (`constructor(private x: T)`), no `enum`s, no namespaces; use explicit fields
and string unions; import siblings with `.ts` extensions. `npm run validate:fast` catches a violation because the unit tests load these files.

## Alternatives considered

- **Compile `lib/` to JavaScript for the server.** Adds a build step to a path that is currently one command.
- **Allow the syntax and bundle.** Would make tests run different code from production.

## Consequences

Slightly more verbose classes; no surprises between the build and the server.

## Revisit when

Node supports the missing syntax in strip mode, or the server moves to a build step.
