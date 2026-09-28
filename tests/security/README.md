# Security and adversarial tests

- `adversarial-inputs.test.ts`: fast-check fuzzing of every parser, projection, and REST query; deep nesting, huge strings, Unicode, extreme numbers, duplicate ids, malformed WebSocket traffic, cursor parameter injection, connection floods.
- `trust-boundaries.test.ts`: the server-side boundaries this app actually has: same-origin WebSocket upgrades, read-only API and socket, credentials that stay on the server, field privacy whatever the client claims to be.

The dashboard has no user accounts; see "Security model" in [../README.md](../README.md).
If accounts or write endpoints are added, their authorization tests belong here.
Run: `npm run test:security`.
