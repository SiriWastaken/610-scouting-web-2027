// Sign in with Google through the real route handlers,
// against the fake provider and a fake account store over real HTTP. Every
// forged or broken response must end on the welcome screen with no session.
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { GET as sessionRoute } from "../../../app/api/auth/session/route.ts";
import { clearJwksCache } from "../../../lib/auth/sign-in.ts";
import { userDocId, type UserDoc } from "../../../lib/auth/accounts.ts";
import { AUDIT_PREFIX } from "../../../lib/auth/audit.ts";
import { authRuntime } from "../../../lib/auth/requests.ts";
import { asUser, CONFIGURED_OWNER, inProcessFetcher, signIn, startTestAuth, TEST_AUTH_SECRET, type TestAuth } from "../../helpers/auth.ts";
import { GOOGLE_CLIENT_SECRET, type TokenFault } from "../../helpers/fake-oidc.ts";

let auth: TestAuth;
const base = "http://dashboard.test";
const fetcher = inProcessFetcher(base);
let n = 0;
const unique = (prefix: string) => `${prefix}-${++n}-${process.pid}`;

before(async () => { auth = await startTestAuth(); auth.apply(); });
beforeEach(() => { auth.apply(); clearJwksCache(); });
after(async () => { await auth.stop(); });

async function whoAmI(cookie: string | null) {
  const response = await sessionRoute(asUser(cookie ? { cookie } : null, `${base}/api/auth/session`));
  return { status: response.status, body: await response.json() as { authenticated: boolean; user?: { email: string; role: string; status: string; displayName: string; providers: string[]; picture: string | null }; session?: { provider: string } } };
}

const errorCode = (location: string) => new URL(location).searchParams.get("error");

test("google: a new team account signs in, lands where it was going, and gets an active session", async () => {
  const email = `${unique("lead")}@team610.test`;
  auth.oidc.setIdentity("google", { sub: unique("g"), email, emailVerified: true, name: "Grace Hopper", picture: "https://lh3.googleusercontent.com/a/grace" });
  const result = await signIn(fetcher, base, "google", { next: "/teams/610" });
  assert.equal(result.status, 303);
  assert.equal(result.location, `${base}/teams/610`);
  assert.ok(result.cookie, "session cookie set");
  const cookie = result.setCookies.find((value) => value.startsWith("610_session="))!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure/, "plain http development origin");
  assert.ok(result.setCookies.some((value) => /^610_oauth=;/.test(value)), "the one-time state cookie is cleared");
  const me = await whoAmI(result.cookie);
  assert.equal(me.status, 200);
  assert.deepEqual({ email: me.body.user?.email, role: me.body.user?.role, status: me.body.user?.status, name: me.body.user?.displayName, provider: me.body.session?.provider, picture: me.body.user?.picture },
    { email, role: "MEMBER", status: "active", name: "Grace Hopper", provider: "google", picture: "https://lh3.googleusercontent.com/a/grace" });
  // The authorization request carried PKCE and a nonce; the token request proved the verifier.
  const authorize = auth.oidc.authorizeRequests.at(-1)!;
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("nonce"));
  assert.equal(authorize.searchParams.get("redirect_uri"), `${base}/api/auth/callback/google`);
  assert.equal(auth.oidc.tokenRequests.at(-1)!.body.get("client_secret"), GOOGLE_CLIENT_SECRET);
});

test("google: anyone who signs in is active straight away, whatever their email domain; there is no approval step", async () => {
  const email = `${unique("visitor")}@gmail.example`;
  auth.oidc.setIdentity("google", { sub: unique("g"), email, emailVerified: true, name: "Ada Lovelace" });
  const result = await signIn(fetcher, base, "google");
  assert.equal(result.status, 303);
  assert.equal(result.location, `${base}/`, "straight to the app, not to a waiting screen");
  const me = await whoAmI(result.cookie);
  assert.deepEqual({ role: me.body.user?.role, status: me.body.user?.status, name: me.body.user?.displayName }, { role: "MEMBER", status: "active", name: "Ada Lovelace" });
  const stored = [...auth.store.docs.values()].map((doc) => doc.body).find((body) => body?.type === "auth_user" && body.email === email) as UserDoc | undefined;
  assert.equal(stored?.status, "active");
  assert.equal(stored?.approvedBy, "automatic");
});

test("apple is gone: its sign-in route is refused and sets no state cookie", async () => {
  const start = await fetcher(`${base}/api/auth/signin/apple`, { redirect: "manual" });
  assert.equal(errorCode(start.headers.get("location")!), "provider_unavailable");
  assert.equal(start.headers.getSetCookie().length, 0);
});

test("the configured Owner email signs in as an active OWNER", async () => {
  auth.oidc.setIdentity("google", { sub: unique("owner"), email: CONFIGURED_OWNER, emailVerified: true, name: "Owner" });
  const result = await signIn(fetcher, base, "google");
  const me = await whoAmI(result.cookie);
  assert.deepEqual({ role: me.body.user?.role, status: me.body.user?.status }, { role: "OWNER", status: "active" });
});

test("an account saved before open access (pending, signed in with Apple) signs in with Google as active and keeps its history", async () => {
  const email = `${unique("legacy")}@team610.test`;
  auth.oidc.setIdentity("google", { sub: unique("g"), email, emailVerified: true, name: "Legacy" });
  const first = await whoAmI((await signIn(fetcher, base, "google")).cookie);
  const userId = (first.body.user as unknown as { id: string }).id;
  const runtime = authRuntime();
  if (!runtime.ok) throw new Error("auth is not configured");
  const doc = await runtime.store.get<UserDoc>(userDocId(userId));
  await runtime.store.update(userDocId(userId), doc!.rev, { ...doc!.body, status: "pending", providers: ["apple", "google"], lastSignInProvider: "apple" });
  assert.equal((await whoAmI((await signIn(fetcher, base, "google")).cookie)).body.user?.status, "active", "pending reads as active, so nobody is locked out");
  const after = await runtime.store.get<UserDoc>(userDocId(userId));
  assert.equal(after!.body.status, "active");
  assert.deepEqual([...after!.body.providers].sort(), ["apple", "google"]);
});

test("unverified or missing emails are refused without creating an account", async () => {
  auth.oidc.setIdentity("google", { sub: unique("g"), email: `${unique("unverified")}@team610.test`, emailVerified: false });
  const unverified = await signIn(fetcher, base, "google");
  assert.equal(errorCode(unverified.location), "email_unverified");
  assert.equal(unverified.cookie, null);
  auth.oidc.setIdentity("google", { sub: unique("g") });
  const hidden = await signIn(fetcher, base, "google");
  assert.equal(errorCode(hidden.location), "no_email");
  assert.equal(hidden.cookie, null);
});

test("forged, expired, or misdirected ID tokens are all rejected", async () => {
  const faults: Array<[TokenFault, string]> = [
    ["bad-signature", "token_invalid"], ["wrong-audience", "token_invalid"], ["wrong-issuer", "token_invalid"], ["expired", "token_invalid"],
    ["wrong-nonce", "token_invalid"], ["alg-none", "token_invalid"], ["unknown-key", "token_invalid"], ["http-500", "exchange_failed"], ["invalid-grant", "expired"],
  ];
  for (const provider of ["google"] as const) {
    for (const [fault, expected] of faults) {
      auth.oidc.setIdentity(provider, { sub: unique(fault), email: `${unique(fault)}@team610.test`, emailVerified: true });
      auth.oidc.fault(fault);
      const result = await signIn(fetcher, base, provider);
      assert.equal(result.status, 303, `${provider} ${fault}`);
      assert.equal(errorCode(result.location), expected, `${provider} ${fault}`);
      assert.equal(result.cookie, null, `${provider} ${fault} must not create a session`);
    }
  }
});

test("state: a callback without this browser's state cookie, with another state, or replayed is refused", async () => {
  auth.oidc.setIdentity("google", { sub: unique("g"), email: `${unique("state")}@team610.test`, emailVerified: true });
  // Login CSRF: an attacker's own code and state, delivered to a victim's browser that never started a sign-in.
  const fresh = new Map<string, string>();
  const noCookie = await signIn(fetcher, base, "google", { jar: fresh, tamper: () => fresh.clear() });
  assert.equal(errorCode(noCookie.location), "state_mismatch");
  const swapped = await signIn(fetcher, base, "google", { tamper: (params) => params.set("state", "attacker-state") });
  assert.equal(errorCode(swapped.location), "state_mismatch");
  // Replaying a completed callback: the state cookie is gone and the code is spent.
  let replayUrl = "";
  const jar = new Map<string, string>();
  await signIn(fetcher, base, "google", { jar, tamper: (params) => { replayUrl = `${base}/api/auth/callback/google?${params}`; } });
  const replay = await fetcher(replayUrl, { redirect: "manual", headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  assert.equal(errorCode(replay.headers.get("location")!), "state_mismatch");
});

test("a cancelled sign-in returns to the welcome screen with a clear reason", async () => {
  auth.oidc.denyNext = true;
  const result = await signIn(fetcher, base, "google");
  assert.equal(errorCode(result.location), "denied");
  assert.equal(result.cookie, null);
});

test("open redirects: the return path can only be a page on this site", async () => {
  for (const next of ["//evil.example/phish", "https://evil.example", "/api/admin/users", "/\\evil.example"]) {
    auth.oidc.setIdentity("google", { sub: unique("r"), email: `${unique("redirect")}@team610.test`, emailVerified: true });
    const result = await signIn(fetcher, base, "google", { next });
    assert.equal(result.location, `${base}/`, next);
  }
});

test("signing in again replaces the old session (no session fixation)", async () => {
  const email = `${unique("fixation")}@team610.test`;
  auth.oidc.setIdentity("google", { sub: unique("g"), email, emailVerified: true });
  const first = await signIn(fetcher, base, "google");
  const jar = new Map([[first.cookie!.split("=")[0], first.cookie!.split("=").slice(1).join("=")]]);
  const second = await signIn(fetcher, base, "google", { jar });
  assert.notEqual(second.cookie, first.cookie);
  assert.equal((await whoAmI(first.cookie)).status, 401, "the earlier session no longer works");
  assert.equal((await whoAmI(second.cookie)).status, 200);
});

test("account store misconfigured after Google approves: welcome says unavailable, the server log names the cause", async () => {
  auth.oidc.setIdentity("google", { sub: unique("g"), email: `${unique("store")}@team610.test`, emailVerified: true });
  const logged = mock.method(console, "error", () => {});
  process.env.AUTH_STORE_DATABASE = "scouting_auth_typo";
  try {
    const result = await signIn(fetcher, base, "google", { next: "/teams" });
    assert.equal(result.status, 303);
    assert.equal(errorCode(result.location), "store_unavailable", "not sent to /teams without a session");
    assert.equal(result.cookie, null);
    const lines = logged.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => line.includes('database "scouting_auth_typo" does not exist')), `server log explains the cause:\n${lines.join("\n")}`);
    assert.equal(lines.join("\n").includes(TEST_AUTH_SECRET), false);
  } finally { logged.mock.restore(); auth.apply(); }
  // Fixed configuration: the same sign-in now completes and lands on the page.
  const fixed = await signIn(fetcher, base, "google", { next: "/teams" });
  assert.equal(fixed.location, `${base}/teams`);
});

test("accounts in a named collection: sign-in works, and a collection Sync Gateway can't see is named in the log", async () => {
  // The whole suite already stores accounts in scouting_auth.app.auth; check a document landed there.
  auth.oidc.setIdentity("google", { sub: unique("g"), email: `${unique("collection")}@team610.test`, emailVerified: true });
  const ok = await signIn(fetcher, base, "google", { next: "/teams" });
  assert.equal(ok.location, `${base}/teams`);
  assert.equal(auth.store.keyspace, "scouting_auth.app.auth");
  assert.ok(auth.store.requests.some((url) => url.pathname.startsWith("/scouting_auth.app.auth/user_")), "documents are addressed through the keyspace");
  // A collection that exists in Couchbase but is not linked to the App Endpoint / Sync Gateway database.
  const logged = mock.method(console, "error", () => {});
  process.env.AUTH_STORE_COLLECTION = "unlinked";
  try {
    const result = await signIn(fetcher, base, "google");
    assert.equal(errorCode(result.location), "store_unavailable");
    const lines = logged.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(lines.some((line) => line.includes('collection "scouting_auth.app.unlinked" is not available') && line.includes("link it")), lines.join("\n"));
  } finally { logged.mock.restore(); auth.apply(); }
  // Scope and collection left unset, on a database that only serves named collections (Capella App Endpoints):
  // the log says to set them, instead of claiming the database does not exist.
  const unset = mock.method(console, "error", () => {});
  delete process.env.AUTH_STORE_SCOPE; delete process.env.AUTH_STORE_COLLECTION;
  try {
    const result = await signIn(fetcher, base, "google");
    assert.equal(errorCode(result.location), "store_unavailable");
    assert.ok(unset.mock.calls.some((call) => String(call.arguments[0]).includes('"scouting_auth" has no default collection on Sync Gateway; set AUTH_STORE_SCOPE and AUTH_STORE_COLLECTION')));
  } finally { unset.mock.restore(); auth.apply(); }
});

test("account store rejecting writes (403 from its sync function or user) is explained, not a silent 404", async () => {
  auth.oidc.setIdentity("google", { sub: unique("g"), email: `${unique("forbidden")}@team610.test`, emailVerified: true });
  const logged = mock.method(console, "error", () => {});
  auth.store.rejectWrites = /^(user|email|identity|session)_/;
  try {
    const result = await signIn(fetcher, base, "google");
    assert.equal(errorCode(result.location), "store_unavailable");
    assert.ok(logged.mock.calls.some((call) => /Account store returned HTTP 503: write rejected/.test(String(call.arguments[0]))));
  } finally { logged.mock.restore(); auth.store.rejectWrites = null; }
});

test("unknown providers and unconfigured sign-in fail safely", async () => {
  const unknown = await fetcher(`${base}/api/auth/signin/facebook`, { redirect: "manual" });
  assert.equal(unknown.status, 303);
  assert.equal(errorCode(unknown.headers.get("location")!), "provider_unavailable");
  const saved = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  try {
    const off = await fetcher(`${base}/api/auth/signin/google`, { redirect: "manual" });
    assert.equal(new URL(off.headers.get("location")!, base).searchParams.get("error"), "unavailable");
    assert.equal((await whoAmI(null)).status, 503, "session checks say unavailable, not signed out");
  } finally { process.env.AUTH_SECRET = saved; }
});

test("https deployments: __Host- session cookie with Secure and SameSite=Lax state cookie", async () => {
  process.env.AUTH_URL = "https://scout.example.org";
  const { GET } = await import("../../../app/api/auth/signin/[provider]/route.ts");
  const googleStart = await GET(new Request("https://scout.example.org/api/auth/signin/google"), { params: Promise.resolve({ provider: "google" }) });
  assert.match(googleStart.headers.get("set-cookie")!, /^__Host-610_oauth=.*; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  assert.match(new URL(googleStart.headers.get("location")!).searchParams.get("redirect_uri")!, /^https:\/\/scout\.example\.org\/api\/auth\/callback\/google$/, "redirect URIs come from AUTH_URL, never the Host header");
  auth.apply();
});

test("audit: sign-ins and failures are recorded with provider and outcome, and never with codes, tokens, or secrets", async () => {
  auth.oidc.setIdentity("google", { sub: unique("g"), email: `${unique("audited")}@team610.test`, emailVerified: true });
  const ok = await signIn(fetcher, base, "google");
  auth.oidc.fault("bad-signature");
  await signIn(fetcher, base, "google");
  const entries = [...auth.store.docs.entries()].filter(([id, doc]) => id.startsWith(AUDIT_PREFIX) && !doc.deleted).map(([, doc]) => doc.body!);
  assert.ok(entries.some((entry) => (entry.action === "auth.signup" || entry.action === "auth.signin") && entry.result === "success"));
  assert.ok(entries.some((entry) => entry.action === "auth.signin" && entry.result === "failure" && (entry.meta as Record<string, unknown>)?.error === "token_invalid"));
  const everything = JSON.stringify([...auth.store.docs.values()]);
  const token = ok.cookie!.split("=")[1];
  for (const secret of [token, token.split(".")[1], TEST_AUTH_SECRET, GOOGLE_CLIENT_SECRET]) assert.equal(everything.includes(secret), false, "the account store never holds session tokens or secrets");
  for (const request of auth.oidc.tokenRequests) assert.equal(everything.includes(request.body.get("code")!), false, "provider codes are never stored");
});
