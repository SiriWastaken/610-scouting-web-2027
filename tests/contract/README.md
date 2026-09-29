# Sync Gateway contract

`sync-gateway.contract.test.ts` pins down the Sync Gateway behaviour this app
depends on: auth, revision conflicts, deletes and recreates, `_changes` shapes,
paging, long-polls, a 400 for an unusable `since`, and the app's own snapshot
and long-poll code against it.

`account-store.contract.test.ts` does the same for the account store
(`lib/auth/store.ts`): create-once uniqueness, revision-checked updates and
deletes, `_all_docs` key ranges and `keys`, database info, and how bad
credentials and an unreachable server surface.

Both run twice:
- against the fake (`npm run test:contract`), everywhere;
- against a real Couchbase Server + Sync Gateway (`npm run test:real`) in CI's `real-couchbase` job.

If the fake stops matching real Sync Gateway, the CI run fails. Only use the
target-agnostic `GatewayTarget` interface here, never fake-only hooks.
