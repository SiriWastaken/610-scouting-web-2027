# Unit tests

Pure logic, no network, no servers. Each file runs in milliseconds.

| Folder | Covers |
|---|---|
| `config/` | Reading Couchbase settings, building the changes-feed URL and auth header |
| `data/` | Aggregate documents → team rows, missing-vs-zero / low-sample / outlier rules and number formatting for the Strategy page, match-document sanitising, and **property tests** (`*.property.test.ts`) for sync invariants: order independence, idempotence, isolation, bounds |
| `realtime/` | Wire protocol and the privacy allow-list, the server bridge / document store / long-poll, the browser client's connection state machine (timeouts, backoff, resync) with mocked timers, and sockets bound to a session (upgrade decisions, re-validation, per-connection metrics) |
| `auth/` | The role and permission matrix, management rules, and pure sign-in helpers: configuration, sealed OAuth state, PKCE, return-path safety, cookies, profile-edit parsing, log scrubbing |

Rules: expected values are written by hand; only time (`mock.timers`) and `Math.random` may be mocked.
Run: `npm run test:unit`. Guide: [../README.md](../README.md).
