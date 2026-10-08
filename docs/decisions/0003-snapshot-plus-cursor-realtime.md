---
title: 0003 Snapshot plus cursor
description: Pages render a snapshot and then follow a live feed that starts at the snapshot's cursor
verified_at: 6c13ac9 (2026-10-08)
sources:
  - docs/12-realtime.md
  - lib/realtime
  - services/couchbase.ts
---

# 0003. Snapshot plus cursor

**Status:** accepted (retrospective)  **Date:** 2026-10-08  **Decided by:** recorded from the code and docs

## Context

Strategists want to see a match appear without refreshing, and the data arrives from tablets over unreliable venue networks, in
any order, and at any time. The database offers a changes feed with a sequence number.

## Decision

The server renders each page from one cached snapshot of the database taken together with the feed's cursor. The browser opens a
WebSocket, sends the cursor, and receives only changes after it. Each document keeps its newest revision; stale and duplicate
changes are ignored; deletions are remembered. On reconnect the browser resumes from the last change it processed; if the server
cannot resume, it says `resync` and the page reloads its snapshot in place.

## Alternatives considered

- **Poll the REST API every few seconds.** Simple, but costs the database a read per tab per interval and still shows stale data
  between polls.
- **Re-send the whole snapshot on any change.** Correct, but wasteful and it flickers.
- **Live feed only, no snapshot.** A page would be blank until the first change arrives.
- **Let the browser talk to Sync Gateway directly.** Skips our access checks and our privacy allow-list.

## Consequences

Nothing is missed and nothing is applied twice, at the price of real machinery (a state machine, a store, a relay) that must be
tested hard and should not be simplified casually ([[11-staying-live]]). Each tab holds its own long-poll upstream, capped at 200 per
server.

## Revisit when

Tab counts approach the cap, or the hosting platform changes how long-lived connections work.
