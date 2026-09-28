// Pure pieces of the sign-in and account code: configuration, encrypted state,
// redirect targets, cookies, profile edits, and what is allowed into logs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText, parsePatch, safePicture } from "../../../lib/auth/accounts.ts";
import { isAutoApproved, readAuthConfig } from "../../../lib/auth/config.ts";
import { pkceChallenge, seal, unseal } from "../../../lib/auth/crypto.ts";
import { safeReturnTo } from "../../../lib/auth/oidc.ts";
import { isTrustedOrigin } from "../../../lib/auth/runtime.ts";
import { describeDevice, readCookie, sessionCookieName } from "../../../lib/auth/sessions.ts";
import { clearCookie, serializeCookie } from "../../../lib/auth/http.ts";
import { routeKey, scrub } from "../../../lib/ops/metrics.ts";

const baseEnv = {
  AUTH_URL: "https://scout.example.org/some/path", AUTH_SECRET: "x".repeat(40),
  AUTH_GOOGLE_CLIENT_ID: "id", AUTH_GOOGLE_CLIENT_SECRET: "secret",
  AUTH_STORE_URL: "https://sg.example.org:4984/", AUTH_STORE_DATABASE: "auth", AUTH_STORE_USERNAME: "u", AUTH_STORE_PASSWORD: "p",
  AUTH_ROOT_EMAILS: " Root@Example.org , second@example.org", AUTH_AUTO_APPROVE: "@team610.org, guest@gmail.com",
};

test("config: a complete environment is parsed; origins, emails, and hours are normalised", () => {
  const result = readAuthConfig(baseEnv);
  assert.ok(result.ok);
  assert.equal(result.config.baseUrl, "https://scout.example.org", "only the origin is used");
  assert.equal(result.config.secureCookies, true);
  assert.deepEqual([...result.config.rootEmails], ["root@example.org", "second@example.org"]);
  assert.deepEqual(Object.keys(result.config.providers), ["google"], "Apple needs all four of its variables");
  assert.equal(result.config.store.url, "https://sg.example.org:4984");
  assert.equal(result.config.sessionMaxAgeMs, 30 * 24 * 3_600_000);
  assert.equal(result.config.sessionIdleMs, 7 * 24 * 3_600_000);
  assert.equal(result.config.providers.google?.issuer, "https://accounts.google.com");
  assert.equal(isAutoApproved(result.config, "Lead@Team610.org"), true);
  assert.equal(isAutoApproved(result.config, "guest@gmail.com"), true);
  assert.equal(isAutoApproved(result.config, "other@gmail.com"), false);
  assert.equal(isAutoApproved(result.config, "x@evilteam610.org"), false, "domain match is exact, not a suffix");
});

test("config: missing or unsafe settings are reported, never guessed", () => {
  const missing = readAuthConfig({});
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.problems.length, 4);
  const shortSecret = readAuthConfig({ ...baseEnv, AUTH_SECRET: "short" });
  assert.ok(!shortSecret.ok && shortSecret.problems.some((problem) => problem.includes("AUTH_SECRET")));
  // Accounts must never live in the database the scouting tablets replicate.
  const sameDb = readAuthConfig({ ...baseEnv, AUTH_STORE_URL: "", COUCHBASE_SYNC_GATEWAY_URL: "https://sg.example.org:4984", COUCHBASE_DATABASE: "auth" });
  assert.ok(!sameDb.ok && sameDb.problems.some((problem) => problem.includes("different Sync Gateway database")));
  const badUrl = readAuthConfig({ ...baseEnv, AUTH_URL: "javascript:alert(1)" });
  assert.ok(!badUrl.ok);
});

test("config: provider endpoints can be redirected for tests, and Apple is enabled with its four variables", () => {
  const result = readAuthConfig({ ...baseEnv, AUTH_OIDC_ENDPOINT_OVERRIDE: "http://127.0.0.1:9/", AUTH_APPLE_CLIENT_ID: "svc", AUTH_APPLE_TEAM_ID: "T", AUTH_APPLE_KEY_ID: "K", AUTH_APPLE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----" });
  assert.ok(result.ok);
  assert.equal(result.config.providers.apple?.tokenEndpoint, "http://127.0.0.1:9/apple/token");
  assert.equal(result.config.providers.google?.issuer, "http://127.0.0.1:9/google");
  assert.equal(result.config.providers.apple?.apple?.privateKey, "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----", "escaped newlines are restored");
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
