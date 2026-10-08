# 610 Scouting Web

> **Proprietary.** Copyright (c) 2026 FIRST Robotics Competition Team 610. All rights reserved. This is not open-source software: you may read it to learn, and team members may use it for the team; copying, modifying, redistributing, hosting or using it to train AI models is not allowed. See [LICENSE](LICENSE) and [the ownership chapter](docs/20-ownership-and-license.md).

Next.js web platform for Team 610 scouting analysis. The Teams, Averages, and Box Plot pages read aggregate data from Couchbase through the server-only repository at `services/couchbase.ts`.

Everyone signs in with Google first, and anyone Google lets through is in straight away; managers can deny access afterwards. The server enforces five roles: **Owner** (set in configuration; everything, including names), **Mentor**, **Scout lead**, **Scout**, and **Member**. Mentors and the Owner get an operations panel for system health, realtime, sync, users, and the audit log.

| Guide | What's in it |
|---|---|
| [docs/00-preface.md](docs/00-preface.md) | **Start here.** The docs are a numbered book (00 Preface to 23 Log): chapters on how we scout and work, each followed by its reference page |
| [docs/10-authentication.md](docs/10-authentication.md) | Sign-in setup (Google, the account store), environment variables, roles and permissions, sessions, account management, audit log, security, local development, troubleshooting |
| [docs/16-operations.md](docs/16-operations.md) | The admin panel: health checks, WebSocket and sync monitoring, API metrics, diagnostics, limitations, event-day troubleshooting |
| [04 architecture](docs/04-architecture.md), [05 data model](docs/05-data-model.md), [12 realtime](docs/12-realtime.md), [13 pages](docs/13-pages.md), [design-system.md](docs/14-design-system.md), [development.md](docs/18-development.md) | How the app is built and how to change it |
| [docs/08-configuration.md](docs/08-configuration.md) | `app.config.ts`: change the team, pages, columns, thresholds or storage backend |
| [tests/README.md](tests/README.md) | The test bench |

## Project map

Every file, grouped by what it's for. Pages and API routes live where Next.js
requires (one folder per URL); everything else is grouped by topic.

**Pages** (`app/`)

| File | What it is |
|---|---|
| `app/layout.tsx`, `app/globals.css` | The HTML shell, fonts, and colours for every page |
| `app/welcome/page.tsx` | The sign-in page (and "Access turned off" for a denied account) |
| `app/(app)/layout.tsx` | Everything behind sign-in: the sidebar shell and the signed-in user |
| `app/(app)/page.tsx` | `/` sends you to Teams |
| `app/(app)/teams/page.tsx`, `teams/[teamNumber]/page.tsx` | Teams list and one team |
| `app/(app)/averages/page.tsx`, `box-plot/page.tsx`, `strategy/page.tsx`, `coverage/page.tsx` | The other dashboard tabs (each is a few lines on top of `LivePage`) |
| `app/(app)/account/page.tsx` | Your account |
| `app/(app)/admin/layout.tsx` | The admin area's header, tabs, and access check |
| `app/(app)/admin/**/page.tsx` | One file per admin tab (overview, realtime, sync, api, users, users/[id], audit, diagnostics) |

**API routes** (`app/api/`, each `route.ts` is one URL)

| Route | What it does |
|---|---|
| `auth/signin/[provider]`, `auth/callback/[provider]`, `auth/signout`, `auth/session` | Start sign-in, finish it, sign out, "who am I" |
| `account`, `account/sessions` | Your own account; sign out other devices |
| `admin/overview`, `admin/diagnostics` | Health and metrics; run all checks now |
| `admin/users`, `admin/users/[id]`, `admin/users/[id]/sessions` | List, view/change one account, sign it out everywhere |
| `admin/audit` | Read the audit log |
| `dashboard-documents` | Team match, pit, and card-report documents for the dashboard |
| `realtime` | The live-updates WebSocket on Vercel (locally, `scripts/server.mjs` serves it) |

**Components** (`components/`)

| File | What it is |
|---|---|
| `ui/kit.tsx` | Shared building blocks: panels, fields, buttons, status pills, stat tiles, empty and access-denied states, date formatting |
| `layout/app-shell.tsx`, `layout/nav-links.tsx` | The sidebar and its tab links |
| `dashboard/teams-view.tsx`, `dashboard/teams/*` | The Teams tab: state and layout, plus one file per panel (match log, auto path, pit report, cards) |
| `dashboard/team-detail.tsx`, `metric-board.tsx`, `coverage.tsx`, `strategy-tools.tsx` | One team, the Averages/Box Plot board, Coverage, Strategy |
| `dashboard/live-page.tsx` | The shared body of every dashboard page: access, snapshot, header from `app.config.ts`, live badge |
| `dashboard/live-status.tsx` | The "Live updates on" bar that keeps a page connected |
| `auth/identity.tsx` | Avatars, the Google icon, role and status badges |
| `auth/session.tsx` | The signed-in user in the browser, and the account chip with sign-out |
| `auth/sign-in.tsx` | The sign-in buttons |
| `auth/account-panel.tsx` | The Account page |
| `admin/shell.tsx` | What all admin tabs share: the one overview request, tabs, refresh bar |
| `admin/health.tsx` | Overview, Sync, API, and Diagnostics tabs |
| `admin/realtime.tsx` | Realtime tab and the WebSocket self-test |
| `admin/users.tsx` | Users list and one user's page |
| `admin/audit-log.tsx` | Audit log tab |

**Server logic** (`lib/`, `services/`, root files)

| File | What it is |
|---|---|
| `lib/auth/roles.ts` | The roles and every permission rule (the only place they're decided) |
| `lib/auth/config.ts` | Sign-in settings from the environment, with checks |
| `lib/auth/sign-in.ts` | Google sign-in: tokens, ID-token verification, state/nonce/PKCE |
| `lib/auth/accounts.ts` | Accounts: finding or creating one at sign-in, the Owner, manager edits |
| `lib/auth/sessions.ts` | Sessions: create, check, expire, revoke |
| `lib/auth/audit.ts` | The audit log |
| `lib/auth/store.ts` | Where accounts live: Sync Gateway, or a local file in development |
| `lib/auth/requests.ts` | "Who is asking?" for every request, and the API route guard |
| `lib/auth/pages.ts` | The access check for pages |
| `lib/realtime/protocol.ts` | The live-updates message format and the field allow-list (privacy) |
| `lib/realtime/documents.ts` | The browser's latest copy of each document |
| `lib/realtime/client.ts`, `hooks.ts` | The browser's WebSocket connection and the React hooks that use it |
| `lib/realtime/server.ts`, `bridge.ts`, `couchbase-feed.ts` | The WebSocket server: upgrade checks, per-connection relay, Sync Gateway long-poll |
| `lib/data/couchbase-config.ts` | Couchbase connection settings |
| `lib/data/aggregates.ts`, `match-data.ts`, `team-documents.ts` | Turning scouting documents into team rows and match rows, and the Teams page's document helpers |
| `lib/data/team-stats.ts` | Number helpers for comparisons: median, outliers, who leads, formatting |
| `lib/domain/*` | The object model: `ScoutingEvent` → `Team` → `Match` / `PitInterview`, and `Alliance` ([docs 06 - The objects](docs/06-the-objects.md)) |
| `lib/ops/metrics.ts` | Counters for the admin panel (connections, requests, errors) |
| `services/scouting-store.ts` | The interface the pages read scouting data through; the backend is chosen in `app.config.ts` |
| `services/couchbase.ts` | The Sync Gateway implementation: reads with a 20 s cache, and health probes |
| `services/health.ts` | The admin panel's health checks |
| `services/blue-alliance.ts` | The Blue Alliance API client (team nicknames on the Teams page, when `TBA_API_KEY` is set) |
| `types/scouting.ts` | Shared scouting data types |
| `public/field.png` | The field diagram behind the auto path |
| `app.config.ts` | **The one file that describes this deployment**: team, pages, Averages columns, analysis thresholds, backend |
| `LICENSE` | Proprietary, all rights reserved ([docs 20 - Ownership and license](docs/20-ownership-and-license.md)) |
| `proxy.ts` | Sends signed-out visitors to the sign-in page (pages re-check for real) |
| `instrumentation.ts` | Records server errors for the admin panel |
| `next.config.ts` | Build info and security headers |

**Scripts and tests**

| File | What it is |
|---|---|
| `scripts/server.mjs` | The Node server `npm run dev` / `npm start` run (Next.js plus WebSockets) |
| `scripts/check-auth.mjs` | `npm run auth:check`: diagnose sign-in setup |
| `scripts/test-bench/*` | The test runner, its manifest of required tests and coverage floors, hygiene, documentation-coverage and function-length checks |
| `scripts/test-infra/*` | Start/stop a real Couchbase + Sync Gateway in Docker for tests |
| `tests/` | The test suites; each folder's README lists its files ([tests/README.md](tests/README.md)) |
| `.env.example` | Every setting, with placeholders; copy to `.env.local` |

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

Copy `.env.example` to `.env.local` (ignored by Git) and fill it in. Sign-in needs the `AUTH_*` variables and a separate Sync Gateway database for accounts; see [docs/10-authentication.md](docs/10-authentication.md#setup). Without them, every page shows the welcome screen with "Sign-in isn't configured".

### Couchbase

The scouting data comes from Sync Gateway:

```env
COUCHBASE_SYNC_GATEWAY_URL=https://your-sync-gateway-host:4984
COUCHBASE_DATABASE=scoutingapp2026
COUCHBASE_USERNAME=your-username
COUCHBASE_PASSWORD=your-password
COUCHBASE_SCOPE=_default
COUCHBASE_COLLECTION=_default
```

Optionally set `TBA_API_KEY` (a Blue Alliance read key) to show official team nicknames.

The repository reads `aggregate_data` documents and uses `pit` documents to enrich team names. No mock data is loaded when Couchbase is not configured; the data pages show an explicit empty state instead.

## Live dashboard updates

Pages update in place when scouting, pit, report, or aggregate documents are created, updated, or deleted in Couchbase. The dashboard opens a same-origin WebSocket feed automatically; the server accepts it only with a valid session for an approved account, re-checks that session every minute, and closes the socket (code 4401) when it is revoked. The server only relays known dashboard document types and explicitly selected fields. Scout names, photos, and free-text notes are excluded. Every approved account can see the dashboard data, so do not put private or sensitive information in fields exposed by the dashboard.

How it works:

- Each page renders from a Couchbase snapshot plus that snapshot's `last_seq`. The browser subscribes from that sequence, and the server long-polls Sync Gateway's `_changes` feed from there, relaying each relevant change.
- The browser keeps the newest revision it has seen for every document, deletions included. Duplicate, stale, or out-of-order events are ignored, and REST results are merged against that store, so every tab converges on the same data.
- After a disconnect the browser reconnects with backoff and resumes from the last sequence it applied, so missed changes are replayed. If Sync Gateway rejects that sequence, the page reloads its data in place.

`npm run dev` and `npm start` run `scripts/server.mjs`, a small Node server that handles `/api/realtime` upgrades and passes everything else to Next.js. Plain `next dev` or `next start` cannot keep a WebSocket open on an app route. Use Node.js 22.6 or later (the test bench needs Node 26, see `.nvmrc`). On Vercel, `app/api/realtime/route.ts` uses Vercel's beta WebSocket support instead (Fluid Compute is enabled in `vercel.json`).

## Checks

Everything is described in [tests/README.md](tests/README.md). In short:

```bash
npx playwright install chromium   # once, for the browser tests
npm run validate:fast             # lint, types, unit, integration, security (before every push)
npm run validate                  # the full bench: adds contract, stress, build, browser E2E, coverage
```

CI runs all of it on every pull request into `main`, plus the contract and browser suites against a real Couchbase Server + Sync Gateway in Docker.

To try the app by hand without real credentials or data, see [Local development](docs/10-authentication.md#local-development) (a fake account store and fake Google sign-in). To try live updates, start the fake Sync Gateway with `FAKE_SG_PORT=4985 node --experimental-strip-types tests/helpers/run-fake-sync-gateway.ts`, point the `COUCHBASE_*` variables at it (`http://127.0.0.1:4985`, database `scouting`, user `dashboard-reader`, password `fake-sg-secret-7f3a91c2`), and write documents with `PUT http://127.0.0.1:4985/scouting/<id>` (updates need `?rev=<current revision>`).
