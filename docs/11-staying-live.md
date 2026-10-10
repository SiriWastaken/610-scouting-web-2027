---
title: 11 - STAYING LIVE
description: How pages update themselves with no refresh, the guarantees that make it safe, and how it fails
verified_at: 6c13ac9 (2026-10-08)
sources:
  - lib/realtime/protocol.ts
  - lib/realtime/client.ts
  - lib/realtime/bridge.ts
  - lib/realtime/couchbase-feed.ts
  - lib/realtime/documents.ts
  - lib/realtime/hooks.ts
  - docs/12-realtime.md
---

# 11 - STAYING LIVE

**Previous:** [[10-authentication]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[12-realtime]]

[[03-a-match-travels]] followed a record from a tablet to a screen at a high level. This chapter is about the part in the middle
that is hardest to get right and most worth understanding: keeping a page current without losing anything, duplicating anything,
or showing one person another person's data.

## The problem in one sentence

A page is a photograph; the event is a film. We render a photograph and then want to keep it matching the film, and the film is
being shot by dozens of tablets whose changes arrive at any time, in any order, over either venue wifi that drops, or our own
toaster. The toaster will be documented in excruciating detail shortly. Stay tuned!

## The solution: a photograph with a bookmark

When the server takes its snapshot it also notes the **cursor** (`last_seq`) of the database at that instant. The page therefore
knows exactly what it contains. The browser then connects and says "I contain everything up to this cursor". From that moment
the server only has to send what happened *after*. Neither side has to guess.

Three properties make that safe:

1. **Nothing is missed.** The feed starts at the cursor, not at "now". A record written between the snapshot and the connection
   is still delivered.
2. **Nothing is applied twice, and nothing stale wins.** Every document carries a revision. The browser's store
   (`lib/realtime/documents.ts`) keeps the newest revision of each document and compares revisions with the same rule Couchbase
   uses to pick a winner. A change that is not newer than what the browser already has is ignored. Deletions are remembered, too,
   so a late-arriving old copy cannot resurrect a deleted document.
3. **The cursor only moves after the change is recorded.** If the connection dies mid-message, the browser resumes from the last
   change it actually processed, not the last one it received.

## The two halves

**In the browser** (`lib/realtime/client.ts`), a small state machine owns one connection per tab, shared by every component. It
connects, sends the subscribe message, and waits for the server to say *ready*. If the handshake takes more than fifteen seconds,
or ready takes more than twenty, or the line goes quiet for more than seventy-five seconds (the server sends something at least
every twenty-five), it hangs up and tries again. Retries back off exponentially (half a second, doubling, up to thirty seconds,
with a little randomness so a roomful of reconnecting browsers does not stampede), and a server that closes politely for a planned
restart is reconnected to almost at once.

**On the server** (`lib/realtime/bridge.ts`), each browser gets its own small relay. It waits up to ten seconds for the subscribe
message, starts that browser's own long-poll of Sync Gateway's changes feed from the cursor, filters every change through the
privacy allow-list, and forwards it. It caps the server at two hundred connections, closes connections before a hosting platform
would cut them off, and re-checks the person's session every minute ([[09-who-is-allowed-in]]). When the session is no longer
valid it closes with code **4401**, which the browser treats as "do not retry": retrying would only fail again.

Each relay is a small class (`BridgeConnection`) so that its state (has this socket subscribed? is it closed? what timers does it
own?) is in one place rather than spread across closures.

## What "resync" means

Sometimes Sync Gateway rejects the cursor and cannot resume from it. The
server tells the browser `resync`. The browser throws away what it learned from the feed, forgets its cursor, and tells the
page to reload its snapshot in place. The refreshed page arrives with a fresh cursor and the cycle starts again. Components that
fetched their own data (the Teams page's per-team matches, pit interview and cards) listen for this and fetch again.

## How you see it

The badge in the corner of each page (*Live updates on*, *Connecting*, *Reconnecting*) is the one visible failure indicator. If
the Teams page cannot fetch a team's documents it shows an empty state, so the badge, and the admin Realtime tab behind it
([[15-event-day]]), are how you tell "no data" from "no connection".

## The rule this section exists to protect

The code is full of unusual-looking care here: limits on message sizes, a guard that drops a document nested so deeply it would
crash the JSON writer, revision comparison written to match Couchbase's own rule. Each exists because of a failure that either
happened or was cheap to test for (the tests send tens of thousands of nested brackets, malformed frames, a flood of
connections, and a database that vanishes mid-stream). **Do not simplify this code without running the stress and security suites**
([[17-how-we-build]]); things that look redundant here usually are not.

## Where to go next

Running all this during an event and reading its health: [[15-event-day]]. The protocol and failure table are in [[12-realtime]].
The reasoning for snapshot-plus-cursor over simpler options is [[0003-snapshot-plus-cursor-realtime]].
