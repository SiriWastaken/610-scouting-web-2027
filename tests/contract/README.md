# Sync Gateway contract

`sync-gateway.contract.test.ts` pins down the Sync Gateway behaviour this app
depends on: auth, revision conflicts, deletes and recreates, `_changes` shapes,
paging, long-polls, a 400 for an unusable `since`, and the app's own snapshot
and long-poll code against it.

It runs twice:
- against the fake (`npm run test:contract`), everywhere;
- against a real Couchbase Server + Sync Gateway (`npm run test:real`) in CI's `real-couchbase` job.

If the fake stops matching real Sync Gateway, the CI run fails. Only use the
target-agnostic `GatewayTarget` interface here, never fake-only hooks.
