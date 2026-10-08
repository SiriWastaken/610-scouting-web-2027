---
title: 13 - PAGES AND ROUTES
description: Every route, who may open it, and the files that build it
verified_at: 6c13ac9 (2026-10-08)
sources:
  - app/(app)
  - app/api
  - components/dashboard
  - components/dashboard/live-page.tsx
  - components/dashboard/teams
  - components/admin
  - lib/auth/roles.ts
---

# 13 - PAGES AND ROUTES

**Previous:** [[12-realtime]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[14-design-system]]

Pages are thin: check access, fetch a snapshot, render a component. All of them call `requirePage` ([[10-authentication]]). The five dashboard pages share `components/dashboard/live-page.tsx` (`LivePage`): it does the access check and snapshot and draws the header (title and description from `navigation` in `app.config.ts`, [[08-configuration]]) with the live-status badge, so a page file is only its body.

## Dashboard (permission `dashboard:read`, any active account)

| URL | Page file | Main component |
|---|---|---|
| `/` | `app/(app)/page.tsx` | redirects to `/teams` |
| `/teams` | `app/(app)/teams/page.tsx` | `components/dashboard/teams-view.tsx` |
| `/teams/<n>` | `app/(app)/teams/[teamNumber]/page.tsx` | `components/dashboard/team-detail.tsx` |
| `/averages`, `/box-plot` | `averages/page.tsx`, `box-plot/page.tsx` | `components/dashboard/metric-board.tsx` |
| `/strategy` | `strategy/page.tsx` | `components/dashboard/strategy-tools.tsx` |
| `/coverage` | `coverage/page.tsx` | `components/dashboard/coverage.tsx` |
| `/account` | `account/page.tsx` | `components/auth/account-panel.tsx` |
| `/welcome` | `app/welcome/page.tsx` | Google sign-in, and "Access turned off" for a denied account |

## The Teams page, piece by piece

`teams-view.tsx` builds the `ScoutingEvent`, owns the selected team and match, loads that team's documents through `useTeamDocuments` ([[12-realtime]]) into a `Team` with its `Match`es and `PitInterview` ([[06-the-objects]]), and composes
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
| `primitives.tsx` | `Section` and `AllianceTag`, shared by the above (`NativeSelect` lives in `selectors.tsx`) |

Document parsing for these lives in `lib/data/team-documents.ts`; the field image is `public/field.png`.
Team nicknames come from The Blue Alliance when `TBA_API_KEY` is set (`services/blue-alliance.ts`), otherwise from the pit name.

## Admin (`/admin/**`)

Overview, Realtime, Sync and API need `ops:read` (Mentor); Diagnostics needs `ops:diagnose`; Users needs
`users:read` (Scout lead); Audit needs `audit:read`. Details in [[16-operations]].

## API routes (`app/api/**/route.ts`)

Every handler goes through `guard()` in `lib/auth/requests.ts`, which checks the session, the permission and
(for writes) the request origin. `dashboard-documents` is the only scouting-data route. The rest are
`auth/*` (sign-in, callback, sign-out, session), `account*`, `admin/*` and `realtime`.
