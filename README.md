# 610 Scouting Web

Next.js web platform for Team 610 scouting analysis. The Teams, Averages, and Box Plot pages read aggregate data from Couchbase through the server-only repository at `services/couchbase.ts`.

Everyone signs in with Google or Apple first. Accounts have roles (member, scout, scout lead, admin, root) enforced by the server, and admins get an operations panel for system health, realtime, sync, users, and the audit log.

| Guide | What's in it |
|---|---|
| [docs/authentication.md](docs/authentication.md) | Sign-in setup (Google, Apple, the account store), environment variables, roles and permissions, sessions, account management, audit log, security, local development, troubleshooting |
| [docs/operations.md](docs/operations.md) | The admin panel: health checks, WebSocket and sync monitoring, API metrics, diagnostics, limitations, event-day troubleshooting |
| [tests/README.md](tests/README.md) | The test bench |

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

Copy `.env.example` to `.env.local` (ignored by Git) and fill it in. Sign-in needs the `AUTH_*` variables and a separate Sync Gateway database for accounts; see [docs/authentication.md](docs/authentication.md#setup). Without them, every page shows the welcome screen with "Sign-in isn't configured".

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

To try the app by hand without real credentials or data, see [Local development](docs/authentication.md#local-development) (a fake account store and fake Google/Apple sign-in). To try live updates, start the fake Sync Gateway with `FAKE_SG_PORT=4985 node --experimental-strip-types tests/helpers/run-fake-sync-gateway.ts`, point the `COUCHBASE_*` variables at it (`http://127.0.0.1:4985`, database `scouting`, user `dashboard-reader`, password `fake-sg-secret-7f3a91c2`), and write documents with `PUT http://127.0.0.1:4985/scouting/<id>` (updates need `?rev=<current revision>`).
