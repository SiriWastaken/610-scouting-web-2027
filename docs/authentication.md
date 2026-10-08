---
title: Authentication, roles, and accounts
description: Sign-in setup, roles and permissions, sessions, audit log, security
verified_at: 885d225 (2026-10-03)
sources:
  - lib/auth/roles.ts
  - lib/auth/config.ts
  - lib/auth/sign-in.ts
  - lib/auth/sessions.ts
  - lib/auth/accounts.ts
  - lib/auth/audit.ts
  - lib/auth/store.ts
  - .env.example
---

# Authentication, roles, and accounts

Everyone signs in with **Google** before seeing any scouting data. Anyone Google
lets through the app's OAuth client is approved automatically; managers can
**deny** access afterwards and allow it again (see [Who gets in](#who-gets-in)).
Accounts have one of five roles, and the server decides what each role may do.
This page covers how it works, how to set it up, and what to do when it breaks.
Operations (the admin panel's health, realtime, and sync views) are in
[[operations]].

## Contents

1. [How it works](#how-it-works) and [Who gets in](#who-gets-in)
2. [Setup](#setup): environment variables, Google, the account store, the first admin
3. [Roles and permissions](#roles-and-permissions)
4. [Sessions](#sessions)
5. [Account management](#account-management)
6. [Audit log](#audit-log)
7. [Security notes](#security-notes)
8. [Local development](#local-development)
9. [Troubleshooting](#troubleshooting)

## How it works

```
browser ── GET /api/auth/signin/google ─▶ dashboard ── 303 + encrypted state cookie ─▶ accounts.google.com
        ◀────────────── user picks an account ──────────────────────────────────────────────┘
browser ── GET /api/auth/callback/google?code&state ─▶ dashboard
                                          ├─ checks state against the cookie (CSRF / login-CSRF)
                                          ├─ exchanges the code server-to-server (+ PKCE verifier)
                                          ├─ verifies the ID token: signature (Google's published keys),
                                          │  issuer, audience, expiry, nonce, verified email
                                          ├─ finds or creates the account (account store)
                                          └─ creates a session; 303 to the page the user wanted
```

Google is the only sign-in method. (Sign in with Apple was removed; leftover
`AUTH_APPLE_*` variables are ignored, and accounts that once used it keep their
history and can sign in with Google through the same verified email.)

### Who gets in

- **Anyone Google lets through the OAuth client.** The Google Cloud OAuth consent screen decides who can finish signing in: *Internal* limits it to your Google Workspace, *External* lets any Google account in (while it is in *Testing*, only the listed test users).
- **A first sign-in creates an active `MEMBER`.** There is no waiting or approval step, and no email allow-list in the app (`AUTH_AUTO_APPROVE` no longer exists).
- **Managers deny access afterwards.** A scout lead, mentor, or the Owner can turn an account off from **Admin → Users** ("Deny access"; the status is `disabled`, shown as **Denied**). That ends every session at once. Trying to sign in again shows **Access turned off**. "Allow access" turns it back on.
- Accounts saved before open access may still say `pending`; they are read as `active` and are corrected on their next sign-in.

No authentication library is added: the flow is ~300 lines in `lib/auth/` on
`node:crypto`, which keeps every check visible and tested.

| Piece | File |
|---|---|
| Role model and every permission rule | `lib/auth/roles.ts` |
| Settings from the environment | `lib/auth/config.ts` |
| Google sign-in: tokens, ID-token verification, state/nonce/PKCE, return paths | `lib/auth/sign-in.ts` |
| Accounts: sign-in resolution, the Owner, manager edits, Owner-only names | `lib/auth/accounts.ts` |
| Sessions | `lib/auth/sessions.ts` |
| Audit log | `lib/auth/audit.ts` |
| Account store (Sync Gateway REST, or a local file in development) | `lib/auth/store.ts` |
| Who is asking (shared by Next.js and the WebSocket server), the API route guard (401/403/503, CSRF, audited denials) | `lib/auth/requests.ts` |
| Page guard (redirect to the sign-in page, access-denied state) | `lib/auth/pages.ts` |
| Optimistic redirect for signed-out visitors | `proxy.ts` |

**Where the checks happen.** `proxy.ts` only sends visitors *without a session
cookie* to `/welcome`; it is never trusted. Every page calls `requirePage()` and
every API route calls `guard()`, which load the session **and the account** from
the account store on each request (10 s per-process cache). The realtime
WebSocket upgrade checks the same session before accepting, and re-checks it
every minute while the socket is open. The browser receives a `permissions`
map only to hide buttons; the server never reads it back.

## Setup

### Environment variables

Copy `.env.example` to `.env.local` for development; set the same names in the
hosting provider for production. `.env.local` is ignored by Git. Never commit
real values.

| Variable | Required | Meaning |
|---|---|---|
| `AUTH_URL` | yes | The exact public origin of the dashboard, e.g. `https://scout.team610.org`. Redirect URIs and the CSRF origin check are built from it, never from the request's `Host` header. `https:` also turns on `Secure` / `__Host-` cookies. |
| `AUTH_SECRET` | yes | ≥ 32 random characters (`openssl rand -base64 48`). Encrypts the short-lived OAuth state cookie. Rotating it only cancels sign-ins in progress. |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | yes | OAuth client of type *Web application*. |
| `AUTH_STORE_DATABASE`, `AUTH_STORE_USERNAME`, `AUTH_STORE_PASSWORD` | yes | A Sync Gateway database **separate from the scouting database** for accounts, sessions, and the audit log (see below). The server refuses to start sign-in if it is the same database. |
| `AUTH_STORE_URL` | no | Sync Gateway public URL for that database. Defaults to `COUCHBASE_SYNC_GATEWAY_URL`. |
| `AUTH_STORE_SCOPE`, `AUTH_STORE_COLLECTION` | no | Keep accounts in a named collection instead (e.g. `app` / `auth`), which may be in the same database as the scouting data. Or write the whole keyspace in `AUTH_STORE_DATABASE`, e.g. `scoutingapp2027.app.auth`. Default `_default`. |
| `AUTH_STORE=local` | development only | Keep accounts, sessions, and the audit log in `.data/auth-store.json` (or `AUTH_STORE_LOCAL_PATH`) instead of Sync Gateway, with real Google sign-in. For working on the app before the account collection is reachable. Refused when `NODE_ENV=production`; delete the line once `npm run auth:check` passes against Sync Gateway. |
| `AUTH_OWNER_EMAILS` | recommended | Comma-separated emails that are always the active **Owner** (every permission; the only one who manages mentors and changes names). Can't be changed or disabled from the app. The earlier name `AUTH_ROOT_EMAILS` still works. |
| `AUTH_SESSION_MAX_AGE_HOURS` | no | Absolute session lifetime. Default 720 (30 days). |
| `AUTH_SESSION_IDLE_HOURS` | no | Sign out after this long without activity. Default 168 (7 days). |
| `AUTH_OIDC_ENDPOINT_OVERRIDE` | **tests only** | Points the Google endpoints at a local stand-in (`tests/helpers/fake-oidc.ts`). Never set in production. |

Google must be configured. If configuration is incomplete, the
welcome screen says sign-in isn't configured, pages stay locked, and the APIs
answer `503`.

### Google (Google Cloud Console)

1. Create or pick a project → **APIs & Services → OAuth consent screen**. User type *External* (or *Internal* if everyone is in one Google Workspace). Add the scopes `openid`, `email`, `profile`. Publish the app (while in *Testing*, only listed test users can sign in). This screen is what decides who can sign in at all; the app approves everyone Google lets through.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorized redirect URIs**: `<AUTH_URL>/api/auth/callback/google` for every environment, e.g. `https://scout.team610.org/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`. (Authorized JavaScript origins are not needed.)
4. Copy the client ID and secret into `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`.

### The account store (Sync Gateway)

Accounts are kept in Couchbase like the scouting data, but in their **own Sync
Gateway database**, so they never replicate to scouting tablets. On your
Couchbase Server / Sync Gateway:

1. Create a bucket for it (e.g. `scouting_auth`, 100 MB is plenty).
2. Create the Sync Gateway database on that bucket (Admin REST API, port 4985):
   ```bash
   curl -u admin:password -X PUT http://sg-host:4985/scouting_auth/ \
     -H 'Content-Type: application/json' -d '{"bucket":"scouting_auth","num_index_replicas":0}'
   ```
3. Create the user the dashboard signs in as, with access to all of it:
   ```bash
   curl -u admin:password -X POST http://sg-host:4985/scouting_auth/_user/ \
     -H 'Content-Type: application/json' \
     -d '{"name":"dashboard-accounts","password":"<long random>","admin_channels":["*"]}'
   ```
4. Do **not** give tablet users access to this database.
5. Set `AUTH_STORE_DATABASE=scouting_auth`, `AUTH_STORE_USERNAME`, `AUTH_STORE_PASSWORD` (and `AUTH_STORE_URL` if it is on another host).

**Or: a collection next to the scouting data** (Couchbase Capella / App Services, or Sync Gateway 3.x with collections):

1. In the bucket, create a collection for accounts, e.g. scope `app`, collection `auth`.
2. **Link it to the App Endpoint** (Capella: App Services → your App Endpoint → Collections), or add it to the Sync Gateway database's config. Sync Gateway only serves linked collections.
3. Give the dashboard's App User access to **all channels (`*`) in that collection**, and keep the collection's sync function accepting its writes (the default `channel(doc.channels)` works). Make sure tablet users have **no** access to it.
4. Set `AUTH_STORE_DATABASE` to the App Endpoint/database name, with `AUTH_STORE_SCOPE=app` and `AUTH_STORE_COLLECTION=auth` (or `AUTH_STORE_DATABASE=<endpoint>.app.auth`), plus `AUTH_STORE_USERNAME`/`AUTH_STORE_PASSWORD`. The app refuses to use the exact collection that holds the scouting data.
5. Run `npm run auth:check`.

Document ids: `user_<id>`, `identity_<provider>_<hash>`, `email_<hash>`,
`session_<userId>_<hash>`, `audit_<ms>_<random>`, and short-lived `diag_*`
documents from the diagnostics round trip.

### The Owner

Put your email in `AUTH_OWNER_EMAILS`, deploy, and sign in: you are the **Owner**.
Then give mentors and scout leads their roles from **Admin → Users**. Ownership
lives only in that variable: it can't be granted, removed, or disabled from the
app, and a role stored in the database never makes anyone an Owner.

## Roles and permissions

| Role | Can | Who gives it |
|---|---|---|
| `MEMBER` | Read every scouting page and the live feed. Everyone starts here. | automatic |
| `SCOUT` | Same as member (the role records who scouts; tablets write to Sync Gateway directly). | scout lead, mentor, Owner |
| `SCOUT_LEAD` | + the user list; deny or allow access; manage **members and scouts** (role, status, note, sign-out). | mentor, Owner |
| `MENTOR` | + the operations panel, diagnostics, and audit log; manage everyone **below mentor**. | Owner |
| `OWNER` | Everything, bypassing every check; the only role that manages mentors and **changes names**. | `AUTH_OWNER_EMAILS` only |

Permissions (`lib/auth/roles.ts`, the only place these are decided):

| Permission | Lowest role | Used by |
|---|---|---|
| `dashboard:read` | MEMBER | every scouting page, `GET /api/dashboard-documents`, the realtime WebSocket |
| `users:read` | SCOUT_LEAD | `/admin/users`, `GET /api/admin/users[/:id]` |
| `users:manage` | SCOUT_LEAD | `PATCH /api/admin/users/:id`, `DELETE /api/admin/users/:id/sessions` (further limited below) |
| `users:rename` | OWNER | changing any display or scout name, including your own (`PATCH /api/admin/users/:id`, `PATCH /api/account`) |
| `ops:read` | MENTOR | `/admin`, `/admin/realtime`, `/admin/sync`, `/admin/api`, `GET /api/admin/overview` |
| `ops:diagnose` | MENTOR | `/admin/diagnostics`, `POST /api/admin/diagnostics` |
| `audit:read` | MENTOR | `/admin/audit`, `GET /api/admin/audit` |

Every permission also requires the account to be **active** (a denied account has
no live session at all), except for the Owner, who passes every check.

Rules for changing another account (`canManageUser`, `assignableRoles`):

- **Nobody changes their own role or status** (no self-elevation, no self-lockout). The profile route accepts display and scout name only (Owner only); any other field, such as `role`, is refused with 400 and audited.
- You may manage an account only if its role is **strictly below yours**; nobody manages the Owner.
- You may grant only roles strictly below yours; `OWNER` is never grantable.
- **Only the Owner changes names**, anyone's. Mentors and scout leads can still keep a private note on accounts they manage.
- Roles saved before the Owner/Mentor model (`ADMIN`, `ROOT`) read as `MENTOR`.
- The admin UI additionally asks you to type the person's email before a change that grants or removes mentor access or denies an account.

## Sessions

- The cookie holds an opaque random token (`<userId>.<256-bit secret>`); the store keeps only its **SHA-256**. `HttpOnly`, `SameSite=Lax`, `Path=/`; on https it is `Secure` and named `__Host-610_session` (no `Domain`, so subdomains can't set or read it).
- Every request re-reads the session and account, so role changes, disabling, and revocation apply without signing in again (within 10 s per server process, the cache window).
- **Idle expiry** (`AUTH_SESSION_IDLE_HOURS`) slides with use (updated at most every 5 minutes); **absolute expiry** (`AUTH_SESSION_MAX_AGE_HOURS`) never moves. Expired sessions are deleted when seen, and each sign-in prunes that account's expired sessions.
- Signing in always creates a new session and ends the browser's previous one (no session fixation).
- Sign-out is a same-origin `POST /api/auth/signout`; it deletes the session server-side and clears the cookie.
- Open pages notice an ended session on focus, every 5 minutes, and immediately when the realtime server closes their socket with code `4401`; they go to the welcome screen ("Your session expired"), which then returns them to where they were.
- If the account store is unreachable, APIs answer **503**, not 401, so a store outage never looks like everyone signing out.

## Account management

**Admin → Users** lists everyone with role, status (Active or Denied), last
sign-in, live session count, and scouting activity (match records carrying their
scout name). Filter by role or status, or search by name, email, or scout name.

An account's page lets permitted managers:

- edit a private **admin note**, and (Owner only) the **display name** and **scout name** (links their tablet submissions);
- change the **role** (only to roles they may grant);
- **deny access** (ends all their sessions immediately) or **allow access** again;
- **sign them out everywhere**;
- see their sign-in methods, sessions (device, last active, expiry), and recent audit history (mentors and the Owner).

Edits carry the revision they were based on; if someone else changed the account
in the meantime, the edit is refused (409) instead of overwriting.
Email addresses can't be edited: they come from the provider and link sign-ins.

Everyone sees their names, role, and sessions in **Account** (the avatar in the
sidebar's bottom corner) and can sign out other devices there. Only the Owner
can edit names, their own included.

## Audit log

Recorded (`lib/auth/audit.ts`), each with time, actor (id, email, role), action,
target, result (`success`/`denied`/`failure`), reason, and small metadata:

| Action | When |
|---|---|
| `auth.signup`, `auth.signin` | account created / signed in (success), or refused (failure/denied, with the error code) |
| `auth.signout` | signed out |
| `users.role`, `users.status`, `users.update` | account changed (before → after), or refused |
| `users.sessions.revoke`, `account.sessions.revoke` | sessions ended |
| `account.update` | own profile changed, or a forged field refused |
| `ops.diagnostics` | diagnostics run |
| `<action>.csrf` | cross-origin write refused |
| `ops.overview`, `users.list`, `audit.read`, … | privileged API refused (at most once per minute per caller and action) |

The app only ever **creates** audit entries: there is no route to edit or delete
them, and reading needs `audit:read`. Tokens, codes, cookies, secrets, and admin
notes are never written (metadata keys that look sensitive are dropped and values
are scrubbed). Anyone with direct Couchbase or Sync Gateway admin access can still
alter documents; restrict that access if the log must be tamper-evident.

## Security notes

- **Server-side authority**: identity, role, status, and permissions are loaded from the account store for every request. Client-supplied headers (`X-User-Role`…), extra cookies, request bodies, and the browser's `permissions` map are ignored (tested in `tests/security/authorization-matrix.test.ts`).
- **OAuth**: state (CSRF and login-CSRF), nonce (token replay), PKCE (Google), single-use codes, ID token signature against the provider's published keys (RS256 only; `none`, HMAC and ES256 are rejected), issuer, audience (`azp` for multi-audience), expiry, not-before. Unverified emails are refused. New provider identities link to an existing account only through a provider-verified email.
- **Redirects**: after sign-in only same-site paths are allowed (`//host`, backslashes, API routes, and absolute URLs fall back to `/`). Redirect URIs come from `AUTH_URL`.
- **CSRF**: `POST`/`PATCH`/`DELETE` require an `Origin` equal to `AUTH_URL`; session cookies are `SameSite=Lax`; bodies must be `application/json`.
- **XSS**: React escapes all user-controlled text (names, notes, audit entries). Profile photos are accepted only from `https://*.googleusercontent.com`.
- **Clickjacking and sniffing**: `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy (`next.config.ts`).
- **WebSocket**: same-origin **and** a valid session with `dashboard:read` before the upgrade; re-checked every minute; revoked sessions are closed with `4401`.
- **Secrets**: the Google client secret, `AUTH_SECRET`, and store credentials exist only on the server. The E2E suite scans every page and JavaScript bundle for them.
- **Data minimisation**: the store keeps email, names, Google photo URL, provider list, timestamps, and hashed session ids. No provider access tokens are kept.

## Local development

Real Google sign-in works on `http://localhost:3000` once that redirect URI is
added to the OAuth client. To work without any real credentials:

```bash
# Terminal 1: fake scouting data (see README) and a fake account store + fake Google
FAKE_SG_PORT=4985 node --experimental-strip-types tests/helpers/run-fake-sync-gateway.ts
node --experimental-strip-types tests/helpers/run-fake-auth.ts > .env.auth.local   # prints AUTH_* lines
# Terminal 2: copy those AUTH_* lines into .env.local (with the COUCHBASE_* ones), then
npm run dev
```

With the fake provider, **Continue with Google** signs in as the configured Owner
(`owner@team610.test`); edit the identity in `tests/helpers/run-fake-auth.ts` to
try signing in as someone new. Its accounts live in memory and disappear when
the process stops.

## Troubleshooting

Start with **`npm run auth:check`**. It reads the same environment as `npm run dev` (`.env.local`) and checks:

- the configuration and the redirect URIs to register;
- whether Sync Gateway is reachable, and whether the account database exists and accepts your credentials;
- a create/update/read/list/delete round trip of one throwaway `diag_*` document, the same operations sign-in uses;
- that Google's signing keys can be reached.

It prints what to fix, never secrets. When sign-in fails after the provider approved it, the server log (the `npm run dev` terminal, or Vercel's function logs) contains a line starting `Sign in with google failed after the provider approved it:` with the cause.

| Symptom | Cause and fix |
|---|---|
| "Sign-in isn't configured", with "`AUTH_…` is still the placeholder from .env.example" (listed on the welcome screen in development, and by `npm run auth:check`) | A value was copied from `.env.example` unchanged. Replace it. `AUTH_STORE_URL` is optional: delete or comment out that line to use `COUCHBASE_SYNC_GATEWAY_URL`. |
| Google approves you, then the welcome screen says **"Accounts are temporarily unavailable"** and you never reach Teams | The server could not read or write the account store right after sign-in. The server log line and `npm run auth:check` say which: the database in `AUTH_STORE_DATABASE` doesn't exist (create it, [above](#the-account-store-sync-gateway)); the user/password are wrong (401); the user may not write there (403: give it `admin_channels: ["*"]` and make sure the database's sync function doesn't reject the documents); or Sync Gateway is unreachable from the server. |
| Welcome screen: "Sign-in isn't configured" | A required variable is missing. `GET /api/auth/session` returns 503; the admin overview's Authentication card lists what's missing. |
| Google: `redirect_uri_mismatch` | Add exactly `<AUTH_URL>/api/auth/callback/google` to the OAuth client. `AUTH_URL` must match the address in the browser (including `www`, port, and `https`). |
| Google: "Access blocked: app not verified / not in test users" | Publish the consent screen or add the user as a test user. |
| "That sign-in link expired or was opened in a different browser" (`state_mismatch`) | Cookies blocked, sign-in started in another browser/tab profile, or `AUTH_URL` differs from the address in use (the state cookie is set for one origin). |
| "Accounts are temporarily unavailable" | The account store isn't reachable: check `AUTH_STORE_*` and Sync Gateway. |
| "Access turned off" | A scout lead, mentor, or the Owner denied that account in Admin → Users. They can allow it again from the same page. |
| Can't open Admin, or you're not the Owner | Your sign-in email must be in `AUTH_OWNER_EMAILS` exactly (case doesn't matter). Fix it and restart the server. |
| A mentor or scout lead can't change someone's name | Expected: only the Owner changes names. |
| Role change not visible yet | Sessions are cached for up to 10 s per server process; reload after that. |
| Live updates stop with "Disconnected" after a while | The session ended (revoked or expired): the page sends the user to sign in again. |
