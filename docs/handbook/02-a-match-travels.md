---
title: A match travels
description: The path of one match record from a scouting tablet to a strategist's screen, step by step
verified_at: 6c13ac9 (2026-10-08)
sources:
  - services/couchbase.ts
  - lib/data/aggregates.ts
  - lib/data/match-data.ts
  - lib/realtime/protocol.ts
  - lib/realtime/bridge.ts
  - lib/realtime/client.ts
---

# Chapter 2. A match travels

Follow one match. Qualification match 31. A scout, call her Ada, watched team 254 play it and has just pressed *Submit*.
Within seconds a strategist in the stands, call him Bo, sees team 254's averages change on his screen without touching
anything. This chapter is how that happens, one hop at a time, and what protects the data at each hop.

## Hop 1. The tablet writes a document

The scouting tablet app is separate from this repository. When Ada submits, it stores a **document**: a small JSON record
named `scouting_254_31`, meaning "scouting data, team 254, match 31". The record has three parts: where the robot started
(alliance colour, position, who scouted it), what it did in autonomous (how much fuel it scored, where it drove, drawn as a
path), and what it did in teleop (fuel scored, passed and plowed, climb attempts and misses, defence played, breakdowns, and
free-text notes).

Documents live in **Couchbase**, a database, behind **Sync Gateway**, a service whose job is to let many devices keep a local
copy of the data and synchronise it. The tablets talk to Sync Gateway directly; they do not go through this dashboard. That
matters later: it is why the dashboard cannot say anything about a tablet's own sync status, and why it can never be the
reason a scout's data is lost.

Other kinds of document exist alongside matches: `pit_254` (the pit interview), `report_card_254_…` (a yellow or red card),
and `aggregate_254`. The last is special. It is not entered by a person: an upstream process computes, for each team, the
averages across all its matches (points per game in each phase, accuracy, ratings) and stores them as `aggregate_254`. The full
list of document types is in [[data-model]].

## Hop 2. The server takes a snapshot

When Bo loads a page, the dashboard's server does **one read** of Sync Gateway's changes feed with all documents included. That
gives it every document at a moment in time, plus a **cursor** (`last_seq`): a marker for "this is exactly how much of the
history I have seen". The server keeps that snapshot for about twenty seconds, so that many people opening pages at once cost
the database one read, not a hundred.

From the snapshot the server builds what the page needs. For the Averages page that is a list of **team rows**, one per
aggregate document, normalised so that the statistic names are consistent (`autoPPG` becomes `autoPpg`; `standing` becomes
`rank`) and so that nonsense is rejected: a document with no statistics, a team number that is not positive, or a body that
disagrees with its own id is dropped. The code for this is `normalizeAggregateDocument` in `lib/data/aggregates.ts`.

## Hop 3. The privacy filter

Everything that leaves the server for a browser first passes through an **allow-list**, written once, in
`projectDashboardDocument` in `lib/realtime/protocol.ts`. For each kind of document it names the fields that may be shown
and discards the rest. Scout names, robot photos and free-text notes are *not* on the list for the live feed. A new field
only reaches a browser if someone deliberately adds it to the list, which is a change a reviewer will see.

This is the central privacy decision in the app, and the reason it lives in one function is so that nobody can add a second
path that forgets to filter. The same filter is applied to the page's first render, to the REST route the Teams page uses,
and to the live feed. (Why the live feed at all? Hop 5.)

## Hop 4. The page renders

The server sends the browser a **plain data** description of the teams, not objects with behaviour: Next.js can only send
plain data from server to browser. In the browser, the page builds the objects the rest of the code talks to: a
`ScoutingEvent` holding `Team`s, each of which can hold `Match`es ([[03-the-objects]]). From then on, anything the screen
needs to know ("is this a real zero or missing?", "is this team's sample too small?") it asks an object.

## Hop 5. Staying current

If the page stopped there, Bo would have to refresh to see Ada's match. Instead, the browser opens a **WebSocket** to the
dashboard and says, in one message, "I have everything up to cursor X; tell me what happens after". The server opens its own
connection to Sync Gateway's changes feed starting at X, filters each change through the allow-list, and relays it. The
browser keeps the newest revision of each document it hears about and merges it onto what the page rendered: so when
`aggregate_254` changes, team 254's row changes, and only that row.

The cursor is the clever part. Because the page and the feed share a cursor, nothing can be missed (the feed starts exactly
where the page's data ended) and nothing is counted twice (a change that is not newer than what the browser has is ignored).
If the connection drops, the browser reconnects with the last cursor it processed and the server replays what it missed. And
if Sync Gateway says it cannot resume from that cursor at all, the server says "resync" and the page reloads its snapshot in
place. The story of all of this, including the ways it can fail, is [[06-staying-live]].

## Hop 6. The screen

Bo sees team 254's total points per game tick from 41.0 to 41.6, a box on the Coverage page turn from "Check" to "Ready", and
the connection badge in the corner still say "Live updates on". He did not touch anything.

## What protected the data along the way

| Hop | Protection |
|---|---|
| Tablet → Sync Gateway | Not this app's job; scouts' data never passes through the dashboard |
| Snapshot | One cached read; the dashboard only reads, never writes, scouting data |
| Normalising | Malformed documents are dropped rather than shown |
| Allow-list | Only named fields leave the server |
| Page and feed | Access is checked on every page, every API call and every WebSocket ([[05-who-is-allowed-in]]) |
| Browser store | Newest revision wins; duplicates and stale updates are ignored |

## Where to go next

The objects the browser builds in hop 4 are the subject of [[03-the-objects]]. For the exact shapes, [[data-model]]; for the
exact protocol, [[realtime]].
