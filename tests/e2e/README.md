# End-to-end tests

The production server (`scripts/server.mjs`, what `npm start` runs) as a child
process, driven over HTTP/WebSocket and in real headless Chromium (Playwright).

| File | Covers | Targets |
|---|---|---|
| `server-http-and-websocket.e2e.test.ts` | Every page renders; no credentials or private fields in any HTML/JS; API methods; realtime through the real server; server restart; unconfigured server | fake |
| `browser-scouting-workflows.e2e.test.ts` | Scout submits → persisted → shown live in two browsers → edit → delete; hand-computed coverage/strategy numbers; sorting; team switching; late-arriving teams | fake **and real Couchbase** |
| `browser-auth-and-admin.e2e.test.ts` | Welcome screen → Google sign-in → return to the requested page → account chip and panel → admin overview health, WebSocket self-test, user editing and role change with confirmation, audit log, diagnostics; outage shown in the dashboard; open sign-in for anyone Google lets through, denied accounts, deny and allow access from Admin → Users, cancelled sign-ins; sign-out and revoked sessions; page access per role | fake |
| `browser-failure-recovery.e2e.test.ts` | Database outage shown and recovered, server restart without reload, malformed documents don't crash the page | fake (fault injection) |

`npm run test:e2e` builds first. The bench refuses to test a missing or stale
build, or to run without Chromium (`npx playwright install chromium`).
`E2E_MODE=dev` tests the dev server instead.
