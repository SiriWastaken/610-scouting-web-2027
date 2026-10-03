---
title: Pages and routes
description: Every route, who may open it, and the files that build it
verified_at: 27726e0 (2026-10-02)
sources:
  - app/(app)
  - app/api
  - components/dashboard
  - components/dashboard/teams
  - components/admin
  - lib/auth/roles.ts
---

# Pages and routes

Pages are thin: check access, fetch a snapshot, render a component. All of them call `requirePage` ([[authentication]]).

## Dashboard (permission `dashboard:read`, any approved account)

| URL | Page file | Main component |
|---|---|---|
| `/` | `app/(app)/page.tsx` | redirects to `/teams` |
| `/teams` | `app/(app)/teams/page.tsx` | `components/dashboard/teams-view.tsx` |
| `/teams/<n>` | `app/(app)/teams/[teamNumber]/page.tsx` | `components/dashboard/team-detail.tsx` |
| `/averages`, `/box-plot` | `averages/page.tsx`, `box-plot/page.tsx` | `components/dashboard/metric-board.tsx` |
| `/strategy` | `strategy/page.tsx` | `components/dashboard/strategy-tools.tsx` |
| `/coverage` | `coverage/page.tsx` | `components/dashboard/coverage.tsx` |
| `/account` | `account/page.tsx` | `components/auth/account-panel.tsx` |
| `/welcome` | `app/welcome/page.tsx` | sign-in and "waiting for approval" |

## The Teams page, piece by piece

`teams-view.tsx` owns state (selected team and match, REST loading, live merge) and composes
`components/dashboard/teams/`:

| File | Panel |
|---|---|
| `selectors.tsx` | Team and match dropdowns |
| `team-summary.tsx` | Rank, matches, and the eight aggregate stats |
| `match-details.tsx` | One match: scout, position, fuel, climb, notes |
| `auto-path.tsx` | Field diagram with the drawn auto path and a replay |
| `match-log.tsx` | The table of every scouted match |
| `scout-report.tsx` | The pit interview, grouped by who said it (asked, interview, observed) |
| `card-reports.tsx` | Cards for the team (loads and updates live on its own) |
| `primitives.tsx` | `Section`, `NativeSelect`, `AllianceTag` shared by the above |

Document parsing for these lives in `lib/data/team-documents.ts`; the field image is `public/field.png`.
Team nicknames come from The Blue Alliance when `TBA_API_KEY` is set (`tba/blueAlliance.ts`), otherwise from the pit name.

## Admin (`/admin/**`)

Overview, Realtime, Sync and API need `ops:read` (Mentor); Diagnostics needs `ops:diagnose`; Users needs
`users:read` (Scout lead); Audit needs `audit:read`. Details in [[operations]].

## API routes (`app/api/**/route.ts`)

Every handler goes through `guard()` in `lib/auth/requests.ts`, which checks the session, the permission and
(for writes) the request origin. `dashboard-documents` is the only scouting-data route. The rest are
`auth/*` (sign-in, callback, sign-out, session), `account*`, `admin/*` and `realtime`.
