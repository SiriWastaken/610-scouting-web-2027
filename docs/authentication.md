# Authentication, roles, and accounts

Everyone signs in with **Google** or **Apple** before seeing any scouting data.
Accounts have one of five roles, and the server decides what each role may do.
This page covers how it works, how to set it up, and what to do when it breaks.
Operations (the admin panel's health, realtime, and sync views) are in
[operations.md](operations.md).

## Contents

1. [How it works](#how-it-works)
2. [Setup](#setup): environment variables, Google, Apple, the account store, the first admin
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

Apple is the same except that Apple sends the user back with a **form POST**
(`response_mode=form_post`, required to receive name and email), the client
secret is an ES256 JWT the server signs with your Apple key, and PKCE is not used.

No authentication library is added: the flow is ~300 lines in `lib/auth/` on
`node:crypto`, which keeps every check visible and tested.

| Piece | File |
|---|---|
| Role model and every permission rule | `lib/auth/roles.ts` |
| Settings from the environment | `lib/auth/config.ts` |
| OAuth/OIDC flow, return-path safety | `lib/auth/oidc.ts`, `lib/auth/jwt.ts`, `lib/auth/crypto.ts` |
| Accounts: sign-in resolution, admin edits, ROOT safeguards | `lib/auth/accounts.ts` |
| Sessions | `lib/auth/sessions.ts` |
| Audit log | `lib/auth/audit.ts` |
| Account store (Sync Gateway REST) | `lib/auth/store.ts` |
| Request authentication (shared by Next.js and the WebSocket server) | `lib/auth/runtime.ts` |
| API route guard (401/403/503, CSRF, audited denials) | `lib/auth/http.ts` |
| Page guard (redirect to the welcome screen, access-denied state) | `lib/auth/next.ts` |
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
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | for Google | OAuth client of type *Web application*. |
| `AUTH_APPLE_CLIENT_ID` | for Apple | The **Services ID** identifier (not the App ID). |
| `AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`, `AUTH_APPLE_PRIVATE_KEY` | for Apple | Team ID, Key ID, and the contents of the downloaded `.p8` key. Literal `\n` line breaks are accepted. |
| `AUTH_STORE_DATABASE`, `AUTH_STORE_USERNAME`, `AUTH_STORE_PASSWORD` | yes | A Sync Gateway database **separate from the scouting database** for accounts, sessions, and the audit log (see below). The server refuses to start sign-in if it is the same database. |
| `AUTH_STORE_URL` | no | Sync Gateway public URL for that database. Defaults to `COUCHBASE_SYNC_GATEWAY_URL`. |
| `AUTH_ROOT_EMAILS` | recommended | Comma-separated emails that are always active `ROOT`. Bootstraps the first admin and can't be demoted or disabled from the app. |
| `AUTH_AUTO_APPROVE` | no | Comma-separated emails or `@domains` that are active `MEMBER`s on first sign-in. Everyone else is `pending` until a scout lead or admin approves them. |
| `AUTH_SESSION_MAX_AGE_HOURS` | no | Absolute session lifetime. Default 720 (30 days). |
| `AUTH_SESSION_IDLE_HOURS` | no | Sign out after this long without activity. Default 168 (7 days). |
| `AUTH_OIDC_ENDPOINT_OVERRIDE` | **tests only** | Points Google/Apple endpoints at a local stand-in (`tests/helpers/fake-oidc.ts`). Never set in production. |

At least one provider must be configured. If configuration is incomplete, the
welcome screen says sign-in isn't configured, pages stay locked, and the APIs
answer `503`.

### Google (Google Cloud Console)

1. Create or pick a project → **APIs & Services → OAuth consent screen**. User type *External* (or *Internal* if everyone is in one Google Workspace). Add the scopes `openid`, `email`, `profile`. Publish the app (while in *Testing*, only listed test users can sign in).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorized redirect URIs**: `<AUTH_URL>/api/auth/callback/google` for every environment, e.g. `https://scout.team610.org/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`. (Authorized JavaScript origins are not needed.)
4. Copy the client ID and secret into `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`.

### Apple (Apple Developer account, paid membership required)

1. **Certificates, IDs & Profiles → Identifiers → App IDs**: create (or reuse) an App ID with **Sign in with Apple** enabled.
2. **Identifiers → Services IDs**: create one (e.g. `org.team610.scouting.web`). This is `AUTH_APPLE_CLIENT_ID`. Enable **Sign in with Apple → Configure**: primary App ID from step 1, **Domains** = your dashboard's host (e.g. `scout.team610.org`), **Return URLs** = `<AUTH_URL>/api/auth/callback/apple`.
3. **Keys**: create a key with **Sign in with Apple** enabled, linked to the App ID. Download the `.p8` file (only possible once). Its Key ID is `AUTH_APPLE_KEY_ID`; the file contents are `AUTH_APPLE_PRIVATE_KEY`.
4. Your Team ID (top right of the developer portal) is `AUTH_APPLE_TEAM_ID`.

Apple does **not** accept `localhost` or plain `http` return URLs, so test Apple
sign-in on an https deployment (a Vercel preview works once its domain is added
to the Services ID). Apple sends the user's name only on their **first**
authorization; if they chose *Hide My Email*, their email is an
`@privaterelay.appleid.com` address, which counts as a separate account from
their Google one.

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

Document ids: `user_<id>`, `identity_<provider>_<hash>`, `email_<hash>`,
`session_<userId>_<hash>`, `audit_<ms>_<random>`, and short-lived `diag_*`
documents from the diagnostics round trip.

### The first admin

Put your email in `AUTH_ROOT_EMAILS`, deploy, and sign in: you are `ROOT`. Then
promote others from **Admin → Users**. Roots from `AUTH_ROOT_EMAILS` are
permanent until removed from the variable.

## Roles and permissions

| Role | Can |
|---|---|
| `MEMBER` | Read every scouting page and the live feed. |
| `SCOUT` | Same as member (the role records who scouts; tablets write to Sync Gateway directly). |
| `SCOUT_LEAD` | + see the user list; approve pending accounts; manage **members and scouts** (names, role, disable, sign out). |
| `ADMIN` | + the operations panel, diagnostics, and audit log; manage everyone **below admin** (up to scout lead). |
| `ROOT` | + manage admins and other roots, grant any role. |

Permissions (`lib/auth/roles.ts`, the only place these are decided):

| Permission | Lowest role | Used by |
|---|---|---|
| `dashboard:read` | MEMBER | every scouting page, `GET /api/dashboard-documents`, the realtime WebSocket |
| `users:read` | SCOUT_LEAD | `/admin/users`, `GET /api/admin/users[/:id]` |
| `users:manage` | SCOUT_LEAD | `PATCH /api/admin/users/:id`, `DELETE /api/admin/users/:id/sessions` (further limited below) |
| `ops:read` | ADMIN | `/admin`, `/admin/realtime`, `/admin/sync`, `/admin/api`, `GET /api/admin/overview` |
| `ops:diagnose` | ADMIN | `/admin/diagnostics`, `POST /api/admin/diagnostics` |
| `audit:read` | ADMIN | `/admin/audit`, `GET /api/admin/audit` |

Every permission also requires the account to be **active**: `pending` and
`disabled` accounts can do nothing except see their own status and sign out.

Rules for changing another account (`canManageUser`, `assignableRoles`):

- **Nobody changes their own account** through the admin routes (no self-elevation, no self-lockout). Your own profile route accepts display name and scout name only; any other field, such as `role`, is refused with 400 and audited.
- You may manage an account only if its role is **strictly below yours**; ROOT may also manage other ROOTs.
- You may grant only roles strictly below yours; ROOT may grant any role.
- Roots from `AUTH_ROOT_EMAILS` can't be changed from the app at all.
- The **last active ROOT** can't be demoted or disabled (409 `last_root`); configured roots that haven't signed in yet count.
- The admin UI additionally asks you to type the person's email before a change that grants or removes admin-level access or disables an account.

## Sessions

- The cookie holds an opaque random token (`<userId>.<256-bit secret>`); the store keeps only its **SHA-256**. `HttpOnly`, `SameSite=Lax`, `Path=/`; on https it is `Secure` and named `__Host-610_session` (no `Domain`, so subdomains can't set or read it).
- Every request re-reads the session and account, so role changes, disabling, and revocation apply without signing in again (within 10 s per server process, the cache window).
- **Idle expiry** (`AUTH_SESSION_IDLE_HOURS`) slides with use (updated at most every 5 minutes); **absolute expiry** (`AUTH_SESSION_MAX_AGE_HOURS`) never moves. Expired sessions are deleted when seen, and each sign-in prunes that account's expired sessions.
- Signing in always creates a new session and ends the browser's previous one (no session fixation).
- Sign-out is a same-origin `POST /api/auth/signout`; it deletes the session server-side and clears the cookie.
- Open pages notice an ended session on focus, every 5 minutes, and immediately when the realtime server closes their socket with code `4401`; they go to the welcome screen ("Your session expired"), which then returns them to where they were.
- If the account store is unreachable, APIs answer **503**, not 401, so a store outage never looks like everyone signing out.

## Account management

**Admin → Users** lists everyone (pending first) with role, status, last sign-in,
live session count, and scouting activity (match records carrying their scout
name). Filter by role or status, or search by name, email, or scout name.
Pending accounts have an **Approve** button right in the list.

An account's page lets permitted managers:

- edit **display name**, **scout name** (links their tablet submissions), and a private **admin note**;
- change the **role** (only to roles they may grant);
- **approve**, **disable** (ends all their sessions immediately), or **re-enable**;
- **sign them out everywhere**;
- see their sign-in methods, sessions (device, last active, expiry), and recent audit history (admins).

Edits carry the revision they were based on; if someone else changed the account
in the meantime, the edit is refused (409) instead of overwriting.
Email addresses can't be edited: they come from the provider and link sign-ins.

Users edit their own display and scout name in **Account** (the avatar in the
sidebar's bottom corner), see their role and sessions there, and can sign out
other devices.

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
- **OAuth**: state (CSRF and login-CSRF), nonce (token replay), PKCE (Google), single-use codes, ID token signature against the provider's published keys (RS256/ES256 only; `none`/HMAC rejected), issuer, audience (`azp` for multi-audience), expiry, not-before. Unverified emails are refused. New provider identities link to an existing account only through a provider-verified email.
- **Redirects**: after sign-in only same-site paths are allowed (`//host`, backslashes, API routes, and absolute URLs fall back to `/`). Redirect URIs come from `AUTH_URL`.
- **CSRF**: `POST`/`PATCH`/`DELETE` require an `Origin` equal to `AUTH_URL`; session cookies are `SameSite=Lax`; bodies must be `application/json`.
- **XSS**: React escapes all user-controlled text (names, notes, audit entries). Profile photos are accepted only from `https://*.googleusercontent.com`.
- **Clickjacking and sniffing**: `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy (`next.config.ts`).
- **WebSocket**: same-origin **and** a valid session with `dashboard:read` before the upgrade; re-checked every minute; revoked sessions are closed with `4401`.
- **Secrets**: client secrets, the Apple key, `AUTH_SECRET`, and store credentials exist only on the server. The E2E suite scans every page and JavaScript bundle for them.
- **Data minimisation**: the store keeps email, names, Google photo URL, provider list, timestamps, and hashed session ids. No provider access tokens are kept.

## Local development

Real Google sign-in works on `http://localhost:3000` once that redirect URI is
added to the OAuth client. To work without any real credentials:

```bash
# Terminal 1: fake scouting data (see README) and a fake account store + fake Google/Apple
FAKE_SG_PORT=4985 node --experimental-strip-types tests/helpers/run-fake-sync-gateway.ts
node --experimental-strip-types tests/helpers/run-fake-auth.ts > .env.auth.local   # prints AUTH_* lines
# Terminal 2: copy those AUTH_* lines into .env.local (with the COUCHBASE_* ones), then
npm run dev
```

With the fake provider, **Continue with Google** signs in as the configured root
(`root@team610.test`) and **Continue with Apple** as a new, pending scout. Its
accounts live in memory and disappear when the process stops.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Welcome screen: "Sign-in isn't configured" | A required variable is missing. `GET /api/auth/session` returns 503; the admin overview's Authentication card lists what's missing. |
| Google: `redirect_uri_mismatch` | Add exactly `<AUTH_URL>/api/auth/callback/google` to the OAuth client. `AUTH_URL` must match the address in the browser (including `www`, port, and `https`). |
| Google: "Access blocked: app not verified / not in test users" | Publish the consent screen or add the user as a test user. |
| Apple: `invalid_client` | Services ID, Team ID, Key ID, or key contents don't match, or the key wasn't enabled for Sign in with Apple. |
| Apple: return URL error at Apple | Return URL and domain must be registered on the **Services ID**; Apple rejects `http` and `localhost`. |
| "That sign-in link expired or was opened in a different browser" (`state_mismatch`) | Cookies blocked, sign-in started in another browser/tab profile, or `AUTH_URL` differs from the address in use (the state cookie is set for one origin). |
| "Accounts are temporarily unavailable" | The account store isn't reachable: check `AUTH_STORE_*` and Sync Gateway. |
| Signed in but "Waiting for approval" | Expected for emails not in `AUTH_AUTO_APPROVE`: a scout lead or admin approves them in Admin → Users. |
| Lost every ROOT | Add your email to `AUTH_ROOT_EMAILS` and redeploy. |
| Role change not visible yet | Sessions are cached for up to 10 s per server process; reload after that. |
| Live updates stop with "Disconnected" after a while | The session ended (revoked or expired): the page sends the user to sign in again. |
