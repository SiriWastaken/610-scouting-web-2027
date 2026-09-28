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
| `run-fake-sync-gateway.ts` | Standalone fake gateway for trying the dashboard by hand (see the project README) |
