# Unit tests

Pure logic, no network, no servers. Each file runs in milliseconds.

| Folder | Covers |
|---|---|
| `config/` | Reading Couchbase settings, building the changes-feed URL and auth header |
| `data/` | Aggregate documents → team rows, match-document sanitising, and **property tests** (`*.property.test.ts`) for sync invariants: order independence, idempotence, isolation, bounds |
| `realtime/` | Wire protocol and the privacy allow-list, the server bridge / document store / long-poll, and the browser client's connection state machine (timeouts, backoff, resync) with mocked timers |

Rules: expected values are written by hand; only time (`mock.timers`) and `Math.random` may be mocked.
Run: `npm run test:unit`. Guide: [../README.md](../README.md).
