# Integration tests

The app's real server code over real HTTP and WebSocket sockets, against the
fake Sync Gateway (a real HTTP server; see `../helpers/fake-sync-gateway.ts`).
Assertions check responses **and** persisted state (`target.read(...)`).

| Folder | Covers |
|---|---|
| `api/` | `GET /api/dashboard-documents`: filtering, schema, 400s, caching, request sharing, persistence read-back |
| `data/` | Team statistics from the hand-computed event dataset, a large generated event, and a property test that a page left open converges with a freshly loaded one |
| `realtime/` | Live sync between clients: create/update/delete, duplicates, stale events, reconnect replay, resync |
| `auth/` | Google and Apple sign-in through the real route handlers (and every forged/broken token), ID token verification edge cases, session lifecycle, user management and ROOT safeguards, the audit log |
| `ops/` | Admin health against Sync Gateway and the account store made to fail; WebSocket metrics against real connections and revocations |
| `resilience/` | Failure injection (outage, timeout, bad credentials, garbage, resets, server restart) and concurrency (duplicate submissions, lost updates, racing deletes, reconnect storms) |

Run: `npm run test:integration`. Guide: [../README.md](../README.md).
