---
title: 16 - OPERATIONS: THE ADMIN PANEL
description: The admin panel: health, WebSocket and sync monitoring, event-day troubleshooting
verified_at: 885d225 (2026-10-03)
sources:
  - components/admin/shell.tsx
  - components/admin/health.tsx
  - components/admin/realtime.tsx
  - services/health.ts
  - lib/ops/metrics.ts
---

# 16 - OPERATIONS: THE ADMIN PANEL

**Previous:** [[15-event-day]]  ·  **Contents:** [[00-preface]]  ·  **Next:** [[17-how-we-build]]

**Admin** (the shield-icon item in the navigation, shown to scout leads, mentors, and the Owner) is where
you answer "is everything working?" at an event, manage who has access, and see
what changed. Access rules are in [[10-authentication]] (Roles and permissions);
scout leads see only **Users**.

Every number comes from the server. Health checks call Sync Gateway and the
account store directly; counters are measured where things happen (the WebSocket
bridge, the long-poll to Sync Gateway, the HTTP server, the sign-in routes).
Nothing is inferred from the admin page having loaded.

## Sections

| Tab | Shows | API |
|---|---|---|
| Overview | Overall status; API, Sync Gateway, Couchbase, WebSockets, account store, and authentication cards; live clients, changes delivered, sign-ins, recent errors; version, commit, build time, environment, uptime, server time, Node.js, memory | `GET /api/admin/overview` |
| Realtime | "Are WebSockets working right now?", a browser self-test, connection and error counters, the upstream feed, open connections, recent events | same |
| Sync | Sync Gateway / Couchbase / account store checks, last successful sync, database sequence, latency, snapshot statistics, documents by type, what cannot be measured | same |
| API | Availability and round trip from your browser, requests by status class, latency percentiles, busiest routes, service list | same |
| Users | Accounts, deny and allow access, editing, roles, sessions ([details](10-authentication.md#account-management)) | `/api/admin/users…` |
| Audit log | Security and admin events, filterable, paged ([details](10-authentication.md#audit-log)) | `GET /api/admin/audit` |
| Diagnostics | Event-day checklist and on-demand checks | `POST /api/admin/diagnostics` |

**Load.** All monitoring tabs share **one** request to `/api/admin/overview`,
every 15 s, only while the browser tab is visible. The server caches its
Sync Gateway and account-store checks for 10 s, so any number of open admin tabs
costs at most two small requests to Sync Gateway per 10 s. In-process counters
are always current. Diagnostics can force fresh checks (at most every 3 s).

## Health checks

| Check | How it is measured | Statuses |
|---|---|---|
| API | This response itself, plus server errors recorded in the last 5 minutes | ok / degraded (recent 5xx) |
| Sync Gateway | `GET /` (server up, version) then `GET /{db}/` with the dashboard's credentials; latency is the total of both | ok, degraded (> 2 s, or the database refuses), down (unreachable or timed out after 5 s), unconfigured |
| Couchbase | The `state` Sync Gateway reports for the database (`Online` means its bucket is connected). The dashboard cannot reach Couchbase Server directly. | ok, degraded (not Online), unknown (Sync Gateway didn't answer) |
| Account store | `GET /{db}/` on the account database | ok, degraded, down, unconfigured |
| WebSockets | Open connections and when the upstream feed last answered (a connected client's long-poll answers at least every ~25 s) | ok, degraded (last feed request failed, or silent for 60 s with clients connected), **idle** (no clients: nothing to measure, so not claimed healthy) |
| Authentication | Configuration, account-store reachability, and whether the latest sign-in in the last 15 minutes failed | ok, degraded, down, unconfigured |
| Persistence (diagnostics only) | Writes a `diag_*` document to the account store, reads it back, compares, deletes it | ok, down |

Overall is **down** if any check is down, **degraded** if any is degraded,
unknown, or unconfigured, otherwise **ok**. Idle does not lower it.

## WebSocket monitoring

Recorded by `lib/realtime/bridge.ts` and `lib/realtime/server.ts` into `lib/ops/metrics.ts`:

- **Active connections** with account role and id, age, starting sequence, frames and changes sent, last frame time.
- **Connected / closed** totals and **connection length** (median and p95 of the last 200 closed connections).
- **Reconnects**: the same account connecting again within 60 s of a disconnect. The server can't see a browser's own retry attempts, so this is the closest honest measure of "clients reconnecting repeatedly".
- **Refused upgrades** by reason: cross-origin, sign-in (no/invalid/inactive session), capacity (200 per server), unconfigured.
- **Malformed subscriptions**, **subscription timeouts**, **sessions ended** (a revoked or expired session closed with `4401`).
- **Errors**: upstream feed errors, resyncs (Sync Gateway rejected a cursor), send failures.
- **Changes delivered** (one per client per change), **frames sent**, the **last change** (document id) and **last sequence** relayed.
- **Upstream feed**: responses, failed requests, last answer, and **new database sequences seen** (each database change counted once, not once per client).
- **Recent events**: the last 200 (connected, reconnected, subscribed, change-delivered, malformed-subscription, rejected:*, feed-error, resync-required, send-error, session-ended, disconnected), filterable by type. No document contents, cookies, or credentials.

**Self-test** (Realtime and Diagnostics tabs): the browser opens a real WebSocket
to `/api/realtime` (through the origin check, the session check, and the upstream
feed), subscribes from the current sequence, and reports the time to open and to
ready. It passes only if the server says the feed is live.

## Sync (Couchbase / Sync Gateway)

- **Last successful sync**: the newest successful answer from Sync Gateway, either the realtime long-poll or a page snapshot.
- **Database sequence**: `update_seq` from `GET /{db}/`.
- **Server snapshot**: pages render from one cached `_changes?include_docs=true` snapshot (20 s). Shown: last fetch, fetch time, documents, sequence, fetch count and failures, last failure, documents by type (match records, team aggregates, pit records, card reports, other).

What is **not** measured, deliberately:

- Scouting tablets replicate directly to Sync Gateway, not through this server, so per-tablet replication status, pending pushes, and conflicts on devices are invisible here. New sequences and delivered changes show that writes are arriving. Sync Gateway's own admin API (port 4985) and Couchbase's UI have per-replication detail; the dashboard deliberately has no admin credentials.
- Bucket-level statistics (RAM, disk, ops/s) need Couchbase Server admin access, which the dashboard does not have.

## API monitoring

`scripts/server.mjs` (what `npm start` and `npm run dev` run) records every HTTP
request: totals, status classes, latency p50/p95/p99 of the last 500 non-static
requests, and per-route counts/errors/average time (ids and team numbers grouped,
e.g. `/teams/:n`). **On Vercel** this server is not used, so traffic is shown as
not measured; use Vercel's observability for that. Server errors from pages and
route handlers are recorded everywhere through `instrumentation.ts`
(`onRequestError`), along with realtime, account-store, and snapshot errors (last
50, messages scrubbed of credentials and codes).

## Diagnostics

The **event-day checklist** answers, from measured data: Is the API alive? Is
Sync Gateway healthy? Is Couchbase reachable? Are WebSockets connected? How many
clients? Are clients reconnecting repeatedly? Are events being generated and
delivered? Are errors increasing (last 15 min vs the 45 before)? Is
authentication working? Is data being persisted? When was the last sync? What
failed most recently?

**Run full diagnostics** re-runs every check without the cache, runs the
persistence round trip, and the WebSocket self-test, and records an
`ops.diagnostics` audit entry. There are no destructive controls: nothing
restarts services, clears data, or writes scouting documents.

## Limitations

- **Per process.** Counters and recent errors live in the server process's memory and reset on restart ("since the server started" is shown). With several instances (Vercel, or multiple Node processes behind a load balancer) each admin request may reach a different instance, with its own numbers. Health checks are unaffected (they query Sync Gateway each time).
- **Revocation delay.** A revoked or disabled account's session cache lasts up to 10 s in other server processes; open sockets are re-checked every 60 s.
- **Couchbase** is observed only through Sync Gateway (see above).

## Troubleshooting at an event

| Symptom | Look at | Likely cause |
|---|---|---|
| Pages load but say "Reconnecting" | Realtime → Upstream feed, recent events | Sync Gateway unreachable or rejecting the dashboard's credentials; check Sync card |
| Sync Gateway **down** | Sync → error text | Network/VPN to Sync Gateway, Sync Gateway stopped, wrong `COUCHBASE_SYNC_GATEWAY_URL` |
| Couchbase **degraded** ("Offline") | Sync card | Sync Gateway lost its bucket; check Couchbase Server |
| Many reconnects | Realtime → events (`disconnected` codes) | Flaky venue Wi-Fi, a proxy cutting idle connections, or the server restarting |
| Refused upgrades: origin | Realtime | The dashboard is opened under a different host than it's served from (proxy `Host` header) |
| Refused upgrades: sign-in | Realtime, Audit log | Expired or ended sessions (including denied accounts) trying to load pages |
| Refused upgrades: capacity | Realtime | More than 200 open tabs on one server; close idle screens |
| No changes delivered while scouts submit | Diagnostics → events generated? | Tablets aren't syncing to this Sync Gateway database; check their connection |
| Sign-ins failing | Overview → Authentication, Audit log (`auth.signin` failures) | Provider configuration; see [authentication.md](10-authentication.md#troubleshooting) |
| Persistence **down** | Diagnostics | Account store rejects writes (bucket full, permissions) |
