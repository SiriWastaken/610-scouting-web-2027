import assert from "node:assert/strict";
import test from "node:test";
import { getCouchbaseChangesConfig, readCouchbaseConfig } from "../../../lib/couchbase-config.ts";

const env: NodeJS.ProcessEnv = { NODE_ENV: "test", COUCHBASE_SYNC_GATEWAY_URL: "https://sg.example:4984", COUCHBASE_DATABASE: "scouting2027", COUCHBASE_USERNAME: "dash", COUCHBASE_PASSWORD: "s3cret" };

test("config: all four connection variables are required; defaults fill scope and collection", () => {
  assert.deepEqual(readCouchbaseConfig(env), { baseUrl: "https://sg.example:4984", database: "scouting2027", username: "dash", password: "s3cret", scope: "_default", collection: "_default" });
  for (const name of ["COUCHBASE_SYNC_GATEWAY_URL", "COUCHBASE_DATABASE", "COUCHBASE_USERNAME", "COUCHBASE_PASSWORD"]) {
    assert.equal(readCouchbaseConfig({ ...env, [name]: undefined }), null, `missing ${name}`);
    assert.equal(readCouchbaseConfig({ ...env, [name]: "" }), null, `empty ${name}`);
  }
  assert.equal(readCouchbaseConfig({ NODE_ENV: "test" }), null);
});

test("config: the changes URL maps ws/wss to http/https, strips a trailing slash, and encodes the database", () => {
  const url = (baseUrl: string, database = "scouting") => getCouchbaseChangesConfig({ ...readCouchbaseConfig(env)!, baseUrl, database })?.url;
  assert.equal(url("wss://sg.example:4984/"), "https://sg.example:4984/scouting/_changes");
  assert.equal(url("ws://127.0.0.1:4984"), "http://127.0.0.1:4984/scouting/_changes");
  assert.equal(url("https://sg.example"), "https://sg.example/scouting/_changes");
  assert.equal(url("https://sg.example", "db/../admin"), "https://sg.example/db%2F..%2Fadmin/_changes", "a database name cannot escape its path segment");
  assert.equal(getCouchbaseChangesConfig(null), null);
});

test("config: credentials become a Basic header that round-trips colons and non-ASCII characters", () => {
  const config = getCouchbaseChangesConfig({ ...readCouchbaseConfig(env)!, username: "dash", password: "p:ss wörd" })!;
  const decoded = Buffer.from(config.authorization.replace(/^Basic /, ""), "base64").toString("utf8");
  assert.equal(decoded, "dash:p:ss wörd");
});
