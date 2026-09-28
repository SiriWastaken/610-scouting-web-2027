# End-to-end tests

The production server (`scripts/server.mjs`, what `npm start` runs) as a child
process, driven over HTTP/WebSocket and in real headless Chromium (Playwright).

| File | Covers | Targets |
|---|---|---|
| `server-http-and-websocket.e2e.test.ts` | Every page renders; no credentials or private fields in any HTML/JS; API methods; realtime through the real server; server restart; unconfigured server | fake |
| `browser-scouting-workflows.e2e.test.ts` | Scout submits → persisted → shown live in two browsers → edit → delete; hand-computed coverage/strategy numbers; sorting; team switching; late-arriving teams | fake **and real Couchbase** |
| `browser-failure-recovery.e2e.test.ts` | Database outage shown and recovered, server restart without reload, malformed documents don't crash the page | fake (fault injection) |

`npm run test:e2e` builds first. The bench refuses to test a missing or stale
build, or to run without Chromium (`npx playwright install chromium`).
`E2E_MODE=dev` tests the dev server instead.
