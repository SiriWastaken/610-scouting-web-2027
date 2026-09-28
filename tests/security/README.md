# Security and adversarial tests

- `adversarial-inputs.test.ts`: fast-check fuzzing of every parser, projection, and REST query; deep nesting, huge strings, Unicode, extreme numbers, duplicate ids, malformed WebSocket traffic, cursor parameter injection, connection floods.
- `trust-boundaries.test.ts`: same-origin and signed-in WebSocket upgrades (Node server and Vercel route), read-only API and socket, credentials that stay on the server, field privacy whatever the client claims to be.
- `authorization-matrix.test.ts`: every protected API route × anonymous, malformed, expired, pending, disabled, and all five roles; forged identity, self-elevation, IDOR, CSRF, audited denials, and a structural check that every admin/account route runs the guard.

See "Security model" in [../README.md](../README.md). New protected routes must be added to the matrix.
Run: `npm run test:security`.
