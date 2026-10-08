# Test helpers

| File | Purpose |
|---|---|
| `fake-sync-gateway.ts` | In-memory Sync Gateway over real HTTP: `_changes` feeds, document CRUD with 409 conflicts, Basic auth, fault injection (`fail`, `fault`, `inject`) |
| `gateway-target.ts` | `startGatewayTarget()`: fake or real (`TEST_SG_TARGET=real`), REST writes like a tablet, `read()` to verify persistence, automatic cleanup, refuses non-empty real databases |
| `realtime-harness.ts` | Production WebSocket upgrade handler on a test server, plus `RealtimeClient`s over real sockets; drop/unreachable/restart controls |
| `app-server.ts` | Runs `scripts/server.mjs` as a child process (production build by default), with restart |
| `browser.ts` | Headless Chromium, per-device contexts, waits on page text and live status |
| `dataset.ts` | Seed documents through REST; point the app's server code at a gateway |
| `wait.ts` | `waitFor` (condition polling with timeouts), seeded PRNG, `mapLimit` |
| `register-aliases.mjs` | Loaded by the bench: resolves `@/` imports and stubs `server-only` so real server modules import in Node |
| `auth.ts` | `startTestAuth()`: a fake account store and fake Google; `auth.user(role)` makes a real session; `signIn()` runs the whole OAuth flow over HTTP or in-process; `asUser()` builds signed-in requests |
| `fake-oidc.ts` | Google stand-in over real HTTP: authorize (redirect), token exchange with PKCE checks, published keys, forged-token faults |
| `run-fake-auth.ts` | Standalone fake account store and provider for local development (docs/10-authentication.md) |
| `run-fake-sync-gateway.ts` | Standalone fake gateway for trying the dashboard by hand (see the project README) |
