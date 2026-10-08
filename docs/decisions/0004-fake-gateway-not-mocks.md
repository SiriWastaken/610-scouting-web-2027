---
title: 0004 A fake gateway, not mocks
description: Tests run against a fake Sync Gateway over real HTTP, kept honest by contract tests
verified_at: 6c13ac9 (2026-10-08)
sources:
  - tests/README.md
  - tests/helpers
---

# 0004. A fake gateway, not mocks

**Status:** accepted (retrospective)  **Date:** 2026-10-08  **Decided by:** recorded from `tests/README.md`

## Context

The behaviour that matters most (revision conflicts, a feed that hangs, a database that vanishes) happens in the conversation
between the app and Sync Gateway. Mocks of our own functions test our assumptions about that conversation, not the conversation.

## Decision

Tests talk to a real HTTP server we wrote that emulates Sync Gateway (changes feed, long-poll, revisions and 409 conflicts, Basic
auth) and can inject faults. A contract suite runs the same expectations against the fake and, in CI, against real Couchbase, so
the fake cannot drift. The app has no fake data of its own: unconfigured, pages show an empty state.

## Alternatives considered

- **Function mocks.** Fast, but they can pass while the real protocol fails.
- **Real Couchbase for everything.** Accurate, but slow, heavy and impossible to make misbehave on demand.

## Consequences

Tests exercise production code paths and failure modes. The cost is maintaining the fake. The accounts store and Google are always
fakes in tests; only a human can check the real providers.

## Revisit when

The contract suite starts needing frequent fixes to the fake, which would mean it is drifting.
