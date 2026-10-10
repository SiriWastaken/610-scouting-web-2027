# Test bench

How to check that the 610 scouting dashboard works before a change reaches `main`.
This guide is written for humans and for AI coding agents alike.

## TL;DR

```bash
nvm use                             # Node 26 (.nvmrc)
npm ci
npx playwright install chromium     # once per machine, for the browser tests
npm run validate:fast               # before every commit/push (~1 min)
npm run validate                    # the full bench: everything CI runs except real Couchbase (~5 min)
```

A change is ready only when `npm run validate` ends with `✔ TEST BENCH PASSED` and CI is green.

## Commands

| Command | What it runs | When |
|---|---|---|
| `npm run validate:fast` | hygiene, lint, typecheck, unit + integration + security suites | Before every commit/push (the pre-push hook runs it) |
| `npm run validate` | everything below except `test:real` | Before opening or updating a PR |
| `npm test` | unit + integration + security | Quick loop while coding |
| `npm run test:unit` | `tests/unit/**`, `tests/testTemplate.test.ts` | Pure logic, milliseconds |
| `npm run test:integration` | `tests/integration/**` | Real HTTP/WebSocket against the fake Sync Gateway |
| `npm run test:security` | `tests/security/**` | Fuzzing and trust boundaries |
| `npm run test:contract` | `tests/contract/**` against the fake | Sync Gateway behaviour the app relies on |
| `npm run test:stress` | `tests/stress/**` | Load: 120 clients, bursts, large datasets |
| `npm run test:e2e` | builds, then `tests/e2e/**` | Production server + real Chromium |
| `npm run test:e2e:prebuilt` | `tests/e2e/**` without building | CI, or right after `npm run build` |
| `npm run test:coverage` | unit + integration + security + contract with coverage | Enforces per-file floors |
| `npm run test:real` | contract + browser workflows against **real** Couchbase | CI; locally with Docker (below) |
| `npm run test:hygiene` | static checks (below) | Part of every validate |
| `npm run lint` / `npm run typecheck` | ESLint (warnings fail) / `tsc --noEmit` | Part of every validate |

To enable the pre-push hook once: `git config core.hooksPath .githooks`.

## What counts as a blocking failure

Any of these fails the bench (non-zero exit) and blocks the PR:

- a failing test, or a test file that crashes while loading;
- a test file listed in `scripts/test-bench/manifest.mjs` that runs **fewer tests than its floor**, or none at all;
- a `*.test.ts` file under `tests/` that is **not** in the manifest (it would never run);
- any skipped or todo test, or `.only`/`.skip`/`.todo`/`{ skip: … }`/`t.skip()` in test code;
- `process.exit` in test code, or a package script / CI step that filters or ignores results (`--test-only`, `--test-name-pattern`, `|| true`, `continue-on-error`);
- the CI workflow no longer running one of the suites;
- per-file coverage below the floors in the manifest;
- an E2E run against a missing or **stale** production build, or without Chromium;
- `test:real` without the `TEST_SG_*` variables, or pointed at a database that already holds data;
- lint warnings, type errors, or a failed `next build`.

A test that didn't run never counts as a pass. Nothing is ever skipped silently.

## Layout

```
tests/
  README.md                 ← you are here
  testTemplate.test.ts      ← copy this to write a new test (it also runs, so it stays correct)
  unit/                     pure logic, no network
    config/                 Couchbase connection settings
    data/                   statistics, team rows, match sanitising, sync invariants (property tests)
    realtime/               wire protocol + privacy, bridge/store/long-poll, browser client state machine, session-bound sockets
    auth/                   role/permission matrix, sign-in helpers (config, sealed state, return paths, cookies)
  integration/              real sockets, fake Sync Gateway
    api/                    GET /api/dashboard-documents
    auth/                   Google sign-in, ID tokens, sessions, user management, audit log
    ops/                    admin health against failing services, WebSocket monitoring
    data/                   scouting statistics end to end, open-page vs fresh-page convergence
    realtime/               live sync between clients over WebSockets
    resilience/             failure injection, concurrent writes
  security/                 fuzzing, hostile input, trust boundaries
  contract/                 Sync Gateway behaviour, against the fake AND real Couchbase
  stress/                   load and bursts
  e2e/                      built app + real Chromium
  fixtures/                 deterministic datasets with hand-computed expected results
  helpers/                  fake Sync Gateway, gateway targets, servers, browser, waits
```

Each folder has a short README with its rules.

## How the bench works

- **Runner**: `scripts/test-bench/run.mjs` runs suites with Node's built-in test runner (`node --test`). A custom reporter (`scripts/test-bench/reporter.mjs`) records every result to `.test-bench/<suite>.json`. The runner then checks those records against the manifest instead of trusting the exit code.
- **Manifest**: `scripts/test-bench/manifest.mjs` lists every test file, its minimum number of passing tests, and the coverage floors. Changing a floor is a visible diff that a reviewer has to accept.
- **Hygiene**: `scripts/test-bench/hygiene.mjs` scans for disabled tests and result-ignoring flags, and checks that CI still runs every suite.
- **Random order**: every run shuffles test order with a seed and prints it (`Seed 12345 (reproduce the order with --seed=12345)`). Property tests (fast-check) use the same seed.
- **TypeScript**: tests are `.ts` and run directly with Node's type stripping. `tests/helpers/register-aliases.mjs` resolves the app's `@/` imports and stubs `server-only`, so tests import real server code (route handlers, `services/couchbase.ts`) without mocks.

## Test infrastructure

| Piece | What it is | Started by |
|---|---|---|
| Fake Sync Gateway (`helpers/fake-sync-gateway.ts`) | A real HTTP server that emulates Sync Gateway's `_changes` feed (normal and long-poll, `since`, `limit`, `include_docs`), document GET/PUT/DELETE with **revision conflicts (409)**, and Basic auth. It can also inject faults: HTTP errors, hangs, garbage bodies, dropped connections. | Each test file, on a random port |
| Gateway target (`helpers/gateway-target.ts`) | One interface over the fake or a real Sync Gateway (`TEST_SG_TARGET`). Writes go through REST exactly as scouting tablets make them; `read()` checks what was persisted. | Each test file |
| Realtime harness (`helpers/realtime-harness.ts`) | The production WebSocket upgrade handler + bridge + long-poll on a plain HTTP server, plus browser-style `RealtimeClient`s over real sockets. Can drop connections, go unreachable, or restart. | Integration/security/contract/stress files |
| App server (`helpers/app-server.ts`) | `scripts/server.mjs` (what `npm start` runs) as a child process. Fails if the build is missing. Supports restart. | E2E files |
| Chromium (`helpers/browser.ts`) | Headless Playwright Chromium; each context is an independent device. | Browser E2E files |
| Fake account store + fake Google (`helpers/auth.ts`, `helpers/fake-oidc.ts`) | A second fake Sync Gateway holding accounts, sessions, and the audit log, and an OpenID Connect provider over real HTTP that behaves like Google (PKCE, redirect), with forged-token faults. `auth.user(role)` makes a real session through the app's account code; `signIn()` runs the full browser flow. | Each test file that needs sign-in |
| Real Couchbase (`scripts/test-infra/couchbase-up.sh`) | Docker: Couchbase Server Community + Sync Gateway, bucket and user provisioned, `TEST_SG_*` exported. | CI `real-couchbase` job, or you |

Real Couchbase locally (needs Docker):

```bash
eval "$(scripts/test-infra/couchbase-up.sh | grep '^TEST_SG_' | sed 's/^/export /')"
npm run build && npm run test:real
scripts/test-infra/couchbase-down.sh
```

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `TEST_SG_TARGET` | tests | `fake` (default) or `real`. Set by the runner from `--target`. |
| `TEST_SG_URL`, `TEST_SG_DATABASE`, `TEST_SG_USERNAME`, `TEST_SG_PASSWORD` | `--target=real` | Public REST endpoint and credentials of a **disposable** Sync Gateway database. Missing values are an error. |
| `TEST_SG_ALLOW_EXISTING=1` | `--target=real` | Allow a database that already has documents (not recommended). |
| `TEST_SEED` | runner, property tests | Fixes the random order and generated data. Same as `--seed=`. |
| `E2E_MODE=dev` | E2E | Test the dev server instead of the production build. |
| `COUCHBASE_*` | the app | Set per test to point the app at the test gateway. Your `.env.local` is never used by tests. |
| `AUTH_*` | the app | Set per test by `helpers/auth.ts` to a fake account store and fake provider (`AUTH_OIDC_ENDPOINT_OVERRIDE`). No real OAuth credentials are ever used. |
| `COUCHBASE_REQUEST_TIMEOUT_MS` | the app | Snapshot request timeout (default 15000). Tests lower it to test timeouts. |

No test needs production credentials or production data.

## Test data, isolation, and cleanup

- `fixtures/event-dataset.ts` holds a small event with edge cases (zeros, missing and partial stats, numeric strings, conflicting duplicates, invalid records, private fields, prefix-colliding team numbers). Every expected number next to it was **computed by hand**. Never compute expectations with the production function under test.
- Each test file starts its own fake gateway and servers on random ports. Nothing is shared between files, and files run in separate processes.
- Inside a file, tests use distinct team numbers or document ids, so they don't depend on order (random ordering enforces this).
- Against a real database, `GatewayTarget` records every document a test creates and deletes them in `stop()`. The target refuses to start on a database that already contains data.
- The server snapshot cache (20 s) is controlled with mocked `Date`, never with sleeps.

## Reproducing a failure

1. Look at the end of the output: the failing file and test, and the **seed**.
2. Re-run the same order: `node scripts/test-bench/run.mjs integration --seed=<seed>`.
3. Narrow it down: `node scripts/test-bench/run.mjs integration --seed=<seed> --grep="failure injection"`. This is repro mode: it exits with 3 even when green, because a filtered run is not validation.
4. Property test failures print a shrunk counterexample and the fast-check seed/path.
5. Raw results for every run are in `.test-bench/*.json` (uploaded as CI artifacts).
6. E2E failures include the server log tail and the page text at the time of failure.

## Writing a new test

Copy `tests/testTemplate.test.ts` into the right folder, then add the file to `scripts/test-bench/manifest.mjs`. The template explains the rules. In short:

- Test behaviour through real interfaces: REST, WebSocket, the database, the browser. Mock only time (`mock.timers`) and randomness.
- Verify persisted state (`target.read`), not just the response.
- Check realtime behaviour with at least two independent clients.
- Write expected values by hand. If a rule changes, update the numbers by hand and say why in the commit.
- Wait for conditions with `waitFor(...)`. Never use fixed sleeps as assertions.
- Never weaken production code to make a test pass. If a test finds a bug, fix the bug.

## Security model (what "authorization" means here)

Everyone signs in with Google; roles and permissions are decided on the server by `lib/auth/roles.ts` (see [docs/10-authentication.md](../docs/10-authentication.md)). Scouting tablets write to Sync Gateway directly with their own credentials, not through this app. The boundaries, and where they are tested:

1. **Authentication and authorization** on every protected page, API route, and the WebSocket: `security/authorization-matrix.test.ts` calls every protected route as anonymous, malformed, expired, denied (disabled), and each of the five roles, with hand-written expected statuses; it also covers forged role headers/cookies/bodies, self-elevation, IDOR, CSRF, and checks that every admin route calls the guard. `e2e/browser-auth-and-admin.e2e.test.ts` checks the rendered pages per role.
2. **Sign-in**: forged, expired, misdirected, and replayed tokens and codes, state/login-CSRF, open redirects, session fixation (`integration/auth/sign-in-flow.test.ts`, `id-token-verification.test.ts`).
3. **Sessions**: expiry, revocation, hashed storage, store outages answered with 503 (`integration/auth/sessions.test.ts`); open sockets closed on revocation (`integration/ops/websocket-monitoring.test.ts`).
4. The realtime WebSocket accepts only same-origin upgrades with a valid session (403/401 otherwise).
5. Browsers can only read scouting data. The dashboard REST API is GET-only (405 otherwise), and messages a browser sends over the socket never reach the database.
6. Couchbase credentials, OAuth secrets, and the upstream address never reach the browser (pages, JS bundles, API, and socket frames are all scanned).
7. Only allow-listed fields leave the server, whatever the client claims (role headers, cookies, subscription fields).
8. Connection floods are capped (1013), and oversized or malformed input closes only the offending socket.

Any new protected route must call `guard()` with a permission and be added to the matrix.

## Coverage

`npm run test:coverage` measures `lib/`, `services/`, and `app/api/`, and enforces **per-file floors** only on code that decides what users see or what leaves the server: parsing and privacy, statistics, sync, API validation, and persistence reads. Floors sit about 3–5 points under today's numbers. There's no global percentage target. The reason for each lower floor is next to it in the manifest (Vercel-only code, browser-only code, unused exports). React components are covered by the browser E2E suite instead.

## Checklist for AI agents

1. Before changing code, run `npm run validate:fast` to see the baseline.
2. After changing code, run `npm run validate`. If you touched Couchbase access or realtime and Docker is available, also run `test:real`.
3. Never add `.skip`/`.only`, lower a floor, delete a test, or edit a hand-computed expectation just to get green. If a floor must change, explain why in the commit message.
4. New behaviour needs a new test in the matching folder (start from `testTemplate.test.ts`) and a manifest entry.
5. Report the final `✔ TEST BENCH PASSED` line and the seed, or the exact failures.

## Known limitations

- The Vercel WebSocket route (`app/api/realtime/route.ts`) only runs inside Vercel's runtime. Its pre-upgrade checks are unit-tested, but the upgraded socket is tested through `scripts/server.mjs`, which uses the same bridge.
- Fault-injection tests (outages, hangs, garbage) need the fake gateway. The contract suite keeps the fake honest against real Sync Gateway in CI.
- Each open dashboard tab holds its own long-poll to Sync Gateway (capped at 200 per server). The stress suite covers 120.
- If a REST request fails, the Teams page shows an empty state rather than an error. Realtime status is the only visible failure indicator.
- The account store and the Google provider are always fakes in tests. `tests/contract/account-store.contract.test.ts` keeps the account store's use of Sync Gateway honest against real Sync Gateway in CI; the real providers can only be checked by hand (docs/10-authentication.md).
- Admin metrics are per process; tests reset them with `resetMetrics()`.
