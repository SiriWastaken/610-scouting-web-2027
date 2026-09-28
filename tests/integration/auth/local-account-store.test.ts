// AUTH_STORE=local: the development-only account store in a file. It must obey
// the same rules as the Sync Gateway store (the account and session code relies
// on them), survive a restart, refuse production, and carry a real sign-in.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { GET as sessionRoute } from "../../../app/api/auth/session/route.ts";
import { readAuthConfig } from "../../../lib/auth/config.ts";
import { LocalAuthStore } from "../../../lib/auth/local-store.ts";
import { ConflictError } from "../../../lib/auth/store.ts";
import { asUser, inProcessFetcher, signIn, startTestAuth, type TestAuth } from "../../helpers/auth.ts";

let auth: TestAuth;
let dir: string;
const base = "http://dashboard.test";

before(async () => { auth = await startTestAuth(); dir = mkdtempSync(join(tmpdir(), "610-local-store-")); });
after(async () => { await auth.stop(); rmSync(dir, { recursive: true, force: true }); });

const forget = (path: string) => { delete (globalThis as Record<symbol, unknown>)[Symbol.for(`610-scouting.local-account-store:${path}`)]; };

test("config: AUTH_STORE=local needs no Sync Gateway settings in development, and is refused in production", () => {
  const env = { ...auth.env(), AUTH_STORE: "local", AUTH_STORE_DATABASE: "", AUTH_STORE_USERNAME: "", AUTH_STORE_PASSWORD: "", AUTH_STORE_URL: "" };
  const dev = readAuthConfig(env);
  assert.ok(dev.ok);
  assert.equal(dev.config.localStorePath, ".data/auth-store.json");
  const production = readAuthConfig({ ...env, NODE_ENV: "production" });
  assert.ok(!production.ok && production.problems.some((problem) => problem.startsWith("AUTH_STORE=local is for development only")));
});

test("same rules as Sync Gateway: create once, revision-checked updates and deletes, prefix listing", async () => {
  const store = new LocalAuthStore(join(dir, "rules.json"));
  const rev = await store.create("user_a", { type: "t", n: 1 });
  assert.match(rev, /^1-[0-9a-f]{16}$/);
  await assert.rejects(store.create("user_a", { n: 2 }), ConflictError);
  const next = await store.update("user_a", rev, { type: "t", n: 2 });
  assert.match(next, /^2-/);
  await assert.rejects(store.update("user_a", rev, { n: 3 }), ConflictError, "a stale revision never overwrites");
  await assert.rejects(store.remove("user_a", rev), ConflictError);
  await store.create("user_b", { type: "t", n: 9 });
  await store.create("session_x", { type: "s" });
  assert.deepEqual((await store.list<{ n: number }>("user_")).map((doc) => [doc.id, doc.body?.n]), [["user_a", 2], ["user_b", 9]]);
  assert.deepEqual((await store.list("user_", { includeDocs: false })).map((doc) => doc.body), [undefined, undefined]);
  assert.deepEqual((await store.getMany<{ n: number }>(["user_b", "missing"])).map((doc) => doc.body.n), [9]);
  assert.equal(await store.remove("user_b", (await store.get("user_b"))!.rev), true);
  assert.equal(await store.remove("user_b", "1-x"), false);
  assert.equal(await store.get("user_b"), null);
  // Callers cannot change stored data by mutating what they read.
  const read = await store.get<{ n: number }>("user_a");
  read!.body.n = 999;
  assert.equal((await store.get<{ n: number }>("user_a"))!.body.n, 2);
  assert.equal((await store.info()).state, "Online (local development file)");
});

test("survives a restart: a new process reads the same file", async () => {
  const path = join(dir, "restart.json");
  const first = new LocalAuthStore(path);
  const rev = await first.create("user_keep", { type: "t", name: "Kept" });
  forget(path); // as if the server restarted
  const second = new LocalAuthStore(path);
  assert.deepEqual(await second.get("user_keep"), { id: "user_keep", rev, body: { type: "t", name: "Kept" } });
});

test("Google sign-in end to end with AUTH_STORE=local: lands on /teams with a working session; the file holds no raw token", async () => {
  const path = join(dir, "signin.json");
  Object.assign(process.env, auth.env(), { AUTH_STORE: "local", AUTH_STORE_LOCAL_PATH: path });
  try {
    auth.oidc.setIdentity("google", { sub: "local-dev-user", email: "dev@team610.test", emailVerified: true, name: "Local Dev" });
    const result = await signIn(inProcessFetcher(base), base, "google", { next: "/teams" });
    assert.equal(result.location, `${base}/teams`);
    const me = await sessionRoute(asUser({ cookie: result.cookie! }, `${base}/api/auth/session`));
    assert.equal(me.status, 200);
    assert.equal(((await me.json()) as { user: { email: string } }).user.email, "dev@team610.test");
    const file = readFileSync(path, "utf8");
    assert.match(file, /dev@team610\.test/);
    assert.equal(file.includes(result.cookie!.split("=")[1].split(".")[1]), false, "only session hashes are stored");
    assert.equal(auth.store.requests.some((url) => url.pathname.includes("/user_")), false, "Sync Gateway was not used");
  } finally {
    delete process.env.AUTH_STORE; delete process.env.AUTH_STORE_LOCAL_PATH;
    auth.apply();
  }
});
