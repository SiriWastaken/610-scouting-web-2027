// The Sync Gateway behaviour the account store relies on (document create /
// update / delete with revision checks, `_all_docs` key ranges and `keys`,
// database info), through the app's own AuthStore class, against the fake and,
// in CI, a real Sync Gateway. If the fake drifts from the real server, this fails.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AuthStore, ConflictError, StoreUnavailableError } from "../../lib/auth/store.ts";
import { startGatewayTarget, type GatewayTarget } from "../helpers/gateway-target.ts";

let target: GatewayTarget;
let store: AuthStore;
const prefix = `bench_store_${process.env.TEST_SEED ?? 0}_`;
const created = new Set<string>();

before(async () => {
  target = await startGatewayTarget();
  store = new AuthStore({ url: target.origin, database: target.database, username: target.username, password: target.password, scope: "_default", collection: "_default" });
});
after(async () => {
  for (const id of created) { const doc = await store.get(id).catch(() => null); if (doc) await store.remove(id, doc.rev).catch(() => {}); }
  await target.stop();
});
const create = async (suffix: string, body: Record<string, unknown>) => { const id = `${prefix}${suffix}`; created.add(id); return { id, rev: await store.create(id, body) }; };

test(`account store contract[${process.env.TEST_SG_TARGET ?? "fake"}]: create, read, and uniqueness (a second create is a conflict)`, async () => {
  const { id, rev } = await create("unique", { type: "auth_email", userId: "u1" });
  const read = await store.get<{ userId: string }>(id);
  assert.deepEqual({ rev: read?.rev, body: read?.body }, { rev, body: { type: "auth_email", userId: "u1" } });
  await assert.rejects(store.create(id, { type: "auth_email", userId: "u2" }), ConflictError);
  assert.equal((await store.get<{ userId: string }>(id))?.body.userId, "u1", "the first writer wins");
  assert.equal(await store.get(`${prefix}missing`), null);
});

test("account store contract: updates need the current revision; stale writes and deletes conflict", async () => {
  const { id, rev } = await create("rev", { type: "t", n: 1 });
  const next = await store.update(id, rev, { type: "t", n: 2 });
  assert.notEqual(next, rev);
  await assert.rejects(store.update(id, rev, { type: "t", n: 3 }), ConflictError);
  await assert.rejects(store.remove(id, rev), ConflictError);
  assert.equal((await store.get<{ n: number }>(id))?.body.n, 2);
  assert.equal(await store.remove(id, next), true);
  assert.equal(await store.get(id), null);
});

test("account store contract: prefix listing is in id order, excludes deleted and other prefixes, with and without bodies", async () => {
  await create("list_b", { type: "t", v: "b" });
  await create("list_a", { type: "t", v: "a" });
  const deleted = await create("list_c", { type: "t", v: "c" });
  await store.remove(deleted.id, deleted.rev);
  await create("lisz", { type: "t", v: "z" });
  const rows = await store.list<{ v: string }>(`${prefix}list_`);
  assert.deepEqual(rows.map((row) => [row.id.slice(prefix.length), row.body?.v]), [["list_a", "a"], ["list_b", "b"]]);
  assert.ok(rows.every((row) => /^1-/.test(row.rev)));
  const ids = await store.list(`${prefix}list_`, { includeDocs: false });
  assert.deepEqual(ids.map((row) => [row.id.slice(prefix.length), row.body]), [["list_a", undefined], ["list_b", undefined]]);
});

test("account store contract: reading several ids at once skips missing and deleted ones", async () => {
  const one = await create("many_1", { type: "t", i: 1 });
  const two = await create("many_2", { type: "t", i: 2 });
  await store.remove(two.id, two.rev);
  const docs = await store.getMany<{ i: number }>([one.id, two.id, `${prefix}many_missing`]);
  assert.deepEqual(docs.map((doc) => [doc.id, doc.body.i]), [[one.id, 1]]);
  assert.deepEqual(await store.getMany([]), []);
});

test("account store contract: database info reports Online and a sequence", async () => {
  const info = await store.info();
  assert.equal(info.state, "Online");
  assert.ok(info.updateSeq !== undefined);
  assert.ok(info.latencyMs >= 0);
});

test("account store contract: a database that does not exist is a configuration error, never 'no such account'", async () => {
  // Sync Gateway answers 404 for a missing database as well as a missing document; treating the first
  // as "not found" once let sign-in continue until its first write failed with an unexplained 404.
  const missing = new AuthStore({ url: target.origin, database: `no_such_db_${process.env.TEST_SEED ?? 0}`, username: target.username, password: target.password, scope: "_default", collection: "_default" });
  for (const call of [() => missing.get("user_u0"), () => missing.info(), () => missing.create(`${prefix}x`, { type: "t" })]) {
    await assert.rejects(call(), (error: unknown) => error instanceof StoreUnavailableError && /does not exist|HTTP 40[13]/.test(error.message));
  }
});

test("account store contract: a document Sync Gateway refuses is an error that carries its reason, not a silent failure", async () => {
  await assert.rejects(store.create(`${prefix}reserved`, { type: "t", _reserved: true }), (error: unknown) => error instanceof StoreUnavailableError && /HTTP 400: .*beginning with '_'/.test(error.message));
  assert.equal(await store.get(`${prefix}reserved`), null, "nothing was written");
});

test("account store contract: wrong credentials and an unreachable server are 'unavailable', never 'not found'", async () => {
  const wrong = new AuthStore({ url: target.origin, database: target.database, username: target.username, password: "wrong-password", scope: "_default", collection: "_default" });
  await assert.rejects(wrong.get(`${prefix}unique`), StoreUnavailableError);
  const nowhere = new AuthStore({ url: "http://127.0.0.1:9", database: target.database, username: "x", password: "y", scope: "_default", collection: "_default" });
  await assert.rejects(nowhere.get("anything"), StoreUnavailableError);
});
