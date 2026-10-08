// Pure pieces of the sign-in and account code: configuration, encrypted state,
// redirect targets, cookies, profile edits, and what is allowed into logs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cleanText, parsePatch, safePicture } from "../../../lib/auth/accounts.ts";
import { readAuthConfig, storeKeyspace } from "../../../lib/auth/config.ts";
import { pkceChallenge, seal, unseal } from "../../../lib/auth/sign-in.ts";
import { safeReturnTo } from "../../../lib/auth/sign-in.ts";
import { isTrustedOrigin } from "../../../lib/auth/requests.ts";
import { describeDevice, readCookie, sessionCookieName } from "../../../lib/auth/sessions.ts";
import { clearCookie, serializeCookie } from "../../../lib/auth/requests.ts";
import { routeKey, scrub } from "../../../lib/ops/metrics.ts";

const baseEnv = {
  AUTH_URL: "https://scout.example.org/some/path", AUTH_SECRET: "x".repeat(40),
  AUTH_GOOGLE_CLIENT_ID: "id", AUTH_GOOGLE_CLIENT_SECRET: "secret",
  AUTH_STORE_URL: "https://sg.example.org:4984/", AUTH_STORE_DATABASE: "auth", AUTH_STORE_USERNAME: "u", AUTH_STORE_PASSWORD: "p",
  AUTH_OWNER_EMAILS: " Owner@Example.org , second@example.org",
};

test("config: a complete environment is parsed; origins, emails, and hours are normalised", () => {
  const result = readAuthConfig(baseEnv);
  assert.ok(result.ok);
  assert.equal(result.config.baseUrl, "https://scout.example.org", "only the origin is used");
  assert.equal(result.config.secureCookies, true);
  assert.deepEqual([...result.config.ownerEmails], ["owner@example.org", "second@example.org"]);
  // The setting's earlier name keeps working.
  const legacy = readAuthConfig({ ...baseEnv, AUTH_OWNER_EMAILS: undefined, AUTH_ROOT_EMAILS: "Legacy@Example.org" });
  assert.ok(legacy.ok);
  assert.deepEqual([...legacy.config.ownerEmails], ["legacy@example.org"]);
  assert.deepEqual(Object.keys(result.config.providers), ["google"], "Google is the only sign-in provider");
  assert.equal(result.config.store.url, "https://sg.example.org:4984");
  assert.equal(result.config.sessionMaxAgeMs, 30 * 24 * 3_600_000);
  assert.equal(result.config.sessionIdleMs, 7 * 24 * 3_600_000);
  assert.equal(result.config.providers.google?.issuer, "https://accounts.google.com");
});

test("config: missing or unsafe settings are reported, never guessed", () => {
  const missing = readAuthConfig({});
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.problems.length, 4);
  const shortSecret = readAuthConfig({ ...baseEnv, AUTH_SECRET: "short" });
  assert.ok(!shortSecret.ok && shortSecret.problems.some((problem) => problem.includes("AUTH_SECRET")));
  // Accounts must never live in the database the scouting tablets replicate.
  const sameDb = readAuthConfig({ ...baseEnv, AUTH_STORE_URL: "", COUCHBASE_SYNC_GATEWAY_URL: "https://sg.example.org:4984", COUCHBASE_DATABASE: "auth" });
  assert.ok(!sameDb.ok && sameDb.problems.some((problem) => problem.includes("different collection (or database) from the scouting data")));
  const badUrl = readAuthConfig({ ...baseEnv, AUTH_URL: "javascript:alert(1)" });
  assert.ok(!badUrl.ok);
});

test("config: the account store URL must be the Sync Gateway / App Services endpoint, never a Couchbase connection string", () => {
  const withUrl = (url: string, database = "auth") => readAuthConfig({ ...baseEnv, AUTH_STORE_URL: url, AUTH_STORE_DATABASE: database });
  const problemsFor = (url: string) => { const result = withUrl(url); return result.ok ? [] : result.problems; };
  // Once, a Capella connection string made the store address "null" and every sign-in fail after Google approved it.
  assert.ok(problemsFor("couchbases://cb.abc123.cloud.couchbase.com").some((problem) => problem.startsWith("AUTH_STORE_URL is a Couchbase connection string")));
  assert.ok(problemsFor("couchbase://localhost").some((problem) => problem.includes("connection string")));
  assert.ok(problemsFor("ftp://sg.example.org").some((problem) => problem.includes("expected https:// or wss://")));
  assert.ok(problemsFor("https://admin:pw@sg.example.org:4984").some((problem) => problem.includes("must not contain a username or password")));
  assert.ok(problemsFor("wss://sg.example.org:4984/some/path").some((problem) => problem.includes("without a path")));
  assert.ok(problemsFor("not a url").some((problem) => problem.includes("not a valid URL")));
  // A copied App Endpoint URL (wss://host:4984/<database>) is fine: trimmed to the server address.
  const copied = withUrl("wss://abc.apps.cloud.couchbase.com:4984/auth/", "auth");
  assert.ok(copied.ok);
  assert.equal(copied.config.store.url, "https://abc.apps.cloud.couchbase.com:4984");
  const fallback = readAuthConfig({ ...baseEnv, AUTH_STORE_URL: "", COUCHBASE_SYNC_GATEWAY_URL: "couchbases://cb.abc123.cloud.couchbase.com" });
  assert.ok(!fallback.ok && fallback.problems.some((problem) => problem.startsWith("COUCHBASE_SYNC_GATEWAY_URL is a Couchbase connection string")), "names the variable the URL actually came from");
});

test("config: accounts in a named collection of the scouting database (scope/collection or a full keyspace)", () => {
  const shared = { ...baseEnv, AUTH_STORE_URL: "", COUCHBASE_SYNC_GATEWAY_URL: "wss://sg.example.org:4984/", COUCHBASE_DATABASE: "scoutingapp2027", AUTH_STORE_DATABASE: "scoutingapp2027" };
  const byParts = readAuthConfig({ ...shared, AUTH_STORE_SCOPE: "app", AUTH_STORE_COLLECTION: "auth" });
  assert.ok(byParts.ok);
  assert.deepEqual({ ...byParts.config.store, password: "" }, { url: "https://sg.example.org:4984", database: "scoutingapp2027", scope: "app", collection: "auth", username: "u", password: "" });
  assert.equal(storeKeyspace(byParts.config.store), "scoutingapp2027.app.auth");
  const byKeyspace = readAuthConfig({ ...shared, AUTH_STORE_DATABASE: "scoutingapp2027.app.auth" });
  assert.ok(byKeyspace.ok);
  assert.equal(storeKeyspace(byKeyspace.config.store), "scoutingapp2027.app.auth");
  assert.equal(storeKeyspace({ database: "accounts", scope: "_default", collection: "_default" }), "accounts", "a separate database's default collection has no keyspace suffix");
  // Same database and same collection as the scouting data: refused.
  const sameCollection = readAuthConfig({ ...shared, COUCHBASE_SCOPE: "app", COUCHBASE_COLLECTION: "auth", AUTH_STORE_SCOPE: "app", AUTH_STORE_COLLECTION: "auth" });
  assert.ok(!sameCollection.ok && sameCollection.problems.some((problem) => problem.includes("different collection")));
  for (const bad of ["scoutingapp2027.auth", "a.b.c.d", "scoutingapp2027.app.a/uth", "scoutingapp2027..auth"]) {
    assert.equal(readAuthConfig({ ...shared, AUTH_STORE_DATABASE: bad }).ok, false, bad);
  }
});

test("config: values left unchanged from .env.example are named before anyone is sent to Google", () => {
  // Once, AUTH_STORE_URL=https://your-sync-gateway-host:4984 passed every check; sign-in then failed after
  // Google approved the user with "Accounts are temporarily unavailable".
  const template = Object.fromEntries(readFileSync(".env.example", "utf8").split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const copied = readAuthConfig({ ...template, AUTH_STORE_URL: "https://your-sync-gateway-host:4984" });
  assert.ok(!copied.ok);
  for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET", "AUTH_STORE_PASSWORD", "AUTH_OWNER_EMAILS", "AUTH_STORE_URL"]) {
    assert.ok(!copied.ok && copied.problems.includes(`${name} is still the placeholder from .env.example`), name);
  }
  assert.equal("AUTH_STORE_URL" in template, false, "the optional store URL is commented out in the template");
  const fallback = readAuthConfig({ ...baseEnv, AUTH_STORE_URL: "", COUCHBASE_SYNC_GATEWAY_URL: template.COUCHBASE_SYNC_GATEWAY_URL });
  assert.ok(!fallback.ok && fallback.problems.some((problem) => problem.startsWith("COUCHBASE_SYNC_GATEWAY_URL (also used for the account store)")));
  assert.ok(readAuthConfig(baseEnv).ok, "real-looking values are not flagged");
});

test("config: provider endpoints can be redirected for tests, and Apple settings are ignored", () => {
  const result = readAuthConfig({ ...baseEnv, AUTH_OIDC_ENDPOINT_OVERRIDE: "http://127.0.0.1:9/", AUTH_APPLE_CLIENT_ID: "svc", AUTH_APPLE_TEAM_ID: "T", AUTH_APPLE_KEY_ID: "K", AUTH_APPLE_PRIVATE_KEY: "abc" });
  assert.ok(result.ok);
  assert.equal(result.config.providers.google?.issuer, "http://127.0.0.1:9/google");
  assert.equal(result.config.providers.google?.tokenEndpoint, "http://127.0.0.1:9/google/token");
  assert.deepEqual(Object.keys(result.config.providers), ["google"], "leftover AUTH_APPLE_* variables do nothing");
});

test("config: Google sign-in is required", () => {
  const result = readAuthConfig({ ...baseEnv, AUTH_GOOGLE_CLIENT_ID: undefined, AUTH_GOOGLE_CLIENT_SECRET: undefined });
  assert.ok(!result.ok && result.problems.some((problem) => problem.includes("Google sign-in is not configured")));
});

test("sealed state: round-trips, and any tampering, other key, or other purpose is rejected", () => {
  const secret = "s".repeat(40);
  const token = seal({ state: "abc", n: 1 }, secret, "oauth-state");
  assert.deepEqual(unseal(token, secret, "oauth-state"), { state: "abc", n: 1 });
  assert.equal(unseal(token, "t".repeat(40), "oauth-state"), null);
  assert.equal(unseal(token, secret, "something-else"), null);
  const raw = Buffer.from(token, "base64url"); raw[raw.length - 1] ^= 1;
  assert.equal(unseal(raw.toString("base64url"), secret, "oauth-state"), null);
  for (const junk of [undefined, "", "abc", "x".repeat(5000)]) assert.equal(unseal(junk, secret, "oauth-state"), null);
  assert.notEqual(seal({ a: 1 }, secret, "p"), seal({ a: 1 }, secret, "p"), "fresh IV each time");
});

test("PKCE: S256 challenge matches the RFC 7636 example", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("return paths: only same-site pages; open redirects and API targets fall back to /", () => {
  const cases: Array<[unknown, string]> = [
    ["/teams/610", "/teams/610"], ["/admin/users?x=1", "/admin/users?x=1"],
    ["//evil.example", "/"], ["/\\evil.example", "/"], ["https://evil.example/", "/"], ["javascript:alert(1)", "/"],
    ["/api/admin/users", "/"], ["/welcome", "/"], ["", "/"], [undefined, "/"], [42, "/"], ["/%0d%0aLocation:evil", "/%0d%0aLocation:evil"],
    ["/\u0000x", "/"], ["/" + "a".repeat(600), "/"],
  ];
  for (const [input, expected] of cases) assert.equal(safeReturnTo(input), expected, JSON.stringify(input));
});

test("cookies: parsing, attributes, and the __Host- prefix on https", () => {
  assert.equal(readCookie("a=1; 610_session=u1.abc; b=2", "610_session"), "u1.abc");
  assert.equal(readCookie(["x=1", "610_session=v"], "610_session"), "v");
  assert.equal(readCookie("610_session_other=1", "610_session"), undefined);
  assert.equal(readCookie(undefined, "610_session"), undefined);
  assert.equal(readCookie("610_session=%E0%A4%A", "610_session"), undefined, "malformed encoding is ignored");
  assert.equal(sessionCookieName({ secureCookies: true }), "__Host-610_session");
  assert.equal(sessionCookieName({ secureCookies: false }), "610_session");
  assert.equal(serializeCookie("n", "v w", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 }), "n=v%20w; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax");
  assert.match(clearCookie("n", false), /^n=; Path=\/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax$/);
});

test("CSRF origin: only the configured origin counts", () => {
  const config = { baseUrl: "https://scout.example.org" };
  assert.equal(isTrustedOrigin("https://scout.example.org", config), true);
  for (const origin of [null, undefined, "", "null", "https://scout.example.org.evil.com", "http://scout.example.org", "https://evil.example"]) assert.equal(isTrustedOrigin(origin, config), false, String(origin));
});

test("profile edits: strict fields, cleaned text, and forged privilege fields rejected by name", () => {
  const forged = parsePatch({ displayName: "Me", role: "ROOT", status: "active" }, "profile");
  assert.equal(forged.ok, false);
  assert.deepEqual(!forged.ok && forged.forbiddenFields, ["role", "status"]);
  const ok = parsePatch({ displayName: "  Ada\u0000 \n Lovelace  ", scoutName: "" }, "profile");
  assert.deepEqual(ok.ok && ok.patch, { displayName: "Ada Lovelace", scoutName: null });
  assert.equal(parsePatch({ displayName: "   " }, "profile").ok, false);
  assert.equal(parsePatch({}, "profile").ok, false, "empty patch");
  assert.equal(parsePatch([], "admin").ok, false);
  assert.equal(parsePatch({ role: "SUPERUSER" }, "admin").ok, false);
  assert.equal(parsePatch({ status: "banned" }, "admin").ok, false);
  const admin = parsePatch({ role: "SCOUT", status: "disabled", adminNote: "x".repeat(900), expectedRev: "3-abc" }, "admin");
  assert.ok(admin.ok);
  assert.equal(admin.ok && admin.patch.adminNote?.length, 500);
  assert.equal(cleanText("a b", 10), "a b");
});

test("profile photos: only https Google-hosted URLs are kept", () => {
  assert.equal(safePicture("https://lh3.googleusercontent.com/a/abc=s96-c"), "https://lh3.googleusercontent.com/a/abc=s96-c");
  for (const url of ["http://lh3.googleusercontent.com/a", "https://evil.example/pixel.gif", "https://googleusercontent.com.evil.example/x", "javascript:alert(1)", 5, undefined]) assert.equal(safePicture(url), undefined, String(url));
});

test("logs: credentials and codes are scrubbed; routes are grouped without ids", () => {
  const text = scrub("GET https://user:hunter2@sg.example/db?code=4/abc&state=xyz failed; Authorization: Basic ZGFzaDpwdw== Bearer eyJhbGci.x.y password=pw");
  for (const secret of ["hunter2", "4/abc", "ZGFzaDpwdw==", "eyJhbGci", "=pw"]) assert.equal(text.includes(secret), false, secret);
  assert.equal(scrub("x".repeat(1000)).length, 300);
  assert.equal(routeKey("/teams/610?x=1"), "/teams/:n");
  assert.equal(routeKey("/api/admin/users/u0123456789abcdef0123/sessions"), "/api/admin/users/:id/sessions");
  assert.equal(routeKey("/_next/static/chunks/x.js"), "/_next/*");
});

test("devices: a short browser/OS summary, never the raw header", () => {
  assert.equal(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"), "Chrome on macOS");
  assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
  assert.equal(describeDevice("curl/8.0"), "Unknown device");
  assert.equal(describeDevice(undefined), undefined);
});
