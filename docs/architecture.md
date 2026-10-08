---
title: Architecture
description: How code is organised and how data moves from Couchbase to the screen
verified_at: 70d836f (2026-10-08)
sources:
  - app/(app)/layout.tsx
  - services/couchbase.ts
  - lib/realtime/server.ts
  - scripts/server.mjs
  - proxy.ts
  - next.config.ts
---

# Architecture

Next.js App Router, React, Tailwind, TypeScript. Node 22.6+ (the test bench wants Node 26, see `.nvmrc`).
Check `node_modules/next/dist/docs/` before relying on Next.js behaviour: this version has breaking changes.

## Where things live

| Folder | What belongs there |
|---|---|
| `app/` | Routes only: one folder per URL, thin `page.tsx` and `route.ts` files that check access, fetch data and render a component |
| `app.config.ts` | Deployment facts: team, navigation, Averages columns, analysis thresholds, scouting backend ([[configuration]]) |
| `services/` | Server-side data access; `scouting-store.ts` is the interface the pages read through, `couchbase.ts` the Sync Gateway implementation |
| `components/` | UI, grouped by feature (`dashboard/`, `admin/`, `auth/`, `layout/`, `ui/`) |
| `components/dashboard/teams/` | The pieces of the Teams page, one file per panel |
| `lib/` | Logic with no UI: `auth/`, `data/`, `realtime/`, `ops/`, `ui/` |
| `services/` | Server-only I/O: Sync Gateway reads (`couchbase.ts`) and health checks (`health.ts`) |
| `tba/` | The Blue Alliance client, used for team nicknames |
| `types/` | Shared TypeScript types |
| `scripts/` | The dev/prod server, auth diagnostics, the test runner |
| `tests/` | See [`tests/README.md`](../tests/README.md) |

`import "server-only"` marks modules that must never reach the browser.

## A page load

1. `proxy.ts` sends signed-out visitors to `/welcome` (a convenience only).
2. The page calls `requirePage(permission)` ([[authentication]]); this is the real check.
3. `await connection()` makes the page render per request, so a build without Couchbase settings still works.
4. The page calls `fetchTeamAggregatesSnapshot()` in `services/couchbase.ts`: one Sync Gateway read, cached for 20 s, which also returns the feed's `last_seq` and the pit-derived team names.
5. A client component renders the rows and `RealtimeConnection` opens the live feed from `last_seq` ([[realtime]]).

## Two servers, one app

`npm run dev` and `npm start` run `scripts/server.mjs`: Next.js plus a WebSocket upgrade handler for
`/api/realtime`. Plain `next dev` cannot hold a WebSocket open. On Vercel, `app/api/realtime/route.ts`
uses Vercel's WebSocket support instead (Fluid Compute is on in `vercel.json`).

## Client fetches

The Teams page loads the selected team's match, pit and card documents from
`GET /api/dashboard-documents?kind=matches|pit|reports&team=<n>`, then lets the live feed add, change and
remove documents on top ([[realtime]]).
