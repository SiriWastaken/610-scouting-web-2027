// Authentication for tests: a separate fake Sync Gateway as the account store,
// the fake Google/Apple provider, and helpers that sign people in through the
// real code paths: either the full OAuth flow over HTTP (like a browser), or
// the account and session functions directly when a test only needs "a
// signed-in SCOUT". No test bypasses the server's session checks.
import { resolveSignIn, userDocId, type UserDoc } from "../../lib/auth/accounts.ts";
import { authRuntime } from "../../lib/auth/runtime.ts";
import { createSession, sessionCookieName } from "../../lib/auth/sessions.ts";
import type { Role, AccountStatus } from "../../lib/auth/roles.ts";
import { FAKE_PASSWORD, FAKE_USERNAME, FakeSyncGateway } from "./fake-sync-gateway.ts";
import { FakeOidcProvider, type Provider } from "./fake-oidc.ts";

export const TEST_AUTH_SECRET = "test-auth-secret-0123456789abcdef-0123456789";
export const AUTH_DATABASE = "scouting_auth";
export const CONFIGURED_ROOT = "root@team610.test";

export interface TestUser { userId: string; email: string; role: Role; status: AccountStatus; token: string; cookie: string }

export interface TestAuth {
  store: FakeSyncGateway;
  oidc: FakeOidcProvider;
  baseUrl: string;
  env(): Record<string, string>;
  /** Points this process's auth code at the test store and provider. */
  apply(): void;
  /** An account with this role and status and a live session, made with the app's own account and session code. */
  user(role: Role, options?: { email?: string; name?: string; status?: AccountStatus; provider?: Provider }): Promise<TestUser>;
  stop(): Promise<void>;
}

let counter = 0;

export async function startTestAuth(options: { baseUrl?: string } = {}): Promise<TestAuth> {
  const store = new FakeSyncGateway(AUTH_DATABASE);
  await store.start();
  const oidc = new FakeOidcProvider();
  await oidc.start();
  const baseUrl = options.baseUrl ?? "http://dashboard.test";
  const auth: TestAuth = {
    store, oidc, baseUrl,
    env: () => ({
      AUTH_URL: baseUrl, AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_STORE_URL: store.origin, AUTH_STORE_DATABASE: AUTH_DATABASE, AUTH_STORE_USERNAME: FAKE_USERNAME, AUTH_STORE_PASSWORD: FAKE_PASSWORD,
      AUTH_ROOT_EMAILS: CONFIGURED_ROOT, AUTH_AUTO_APPROVE: "@team610.test",
      ...oidc.appEnv(),
    }),
    apply: () => { Object.assign(process.env, auth.env()); },
    async user(role, userOptions = {}) {
      auth.apply();
      const runtime = authRuntime();
      if (!runtime.ok) throw new Error(`Test auth is misconfigured: ${runtime.problems.join("; ")}`);
      counter += 1;
      const email = userOptions.email ?? `${role.toLowerCase()}-${process.pid}-${counter}@team610.test`;
      const provider = userOptions.provider ?? "google";
      const outcome = await resolveSignIn(runtime.store, runtime.config, { provider, subject: `sub-${email}`, email, emailVerified: true, name: userOptions.name ?? `${role} ${counter}` });
      const userId = outcome.userId!;
      // Test setup writes the role straight to the database, as a fixture; the app's role-change rules are tested separately.
      const current = await runtime.store.get<UserDoc>(userDocId(userId));
      const status = userOptions.status ?? "active";
      await runtime.store.update(userDocId(userId), current!.rev, { ...current!.body, role, status });
      const { token } = await createSession(runtime.store, runtime.config, userId, provider, "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/130.0 Safari/537.36");
      return { userId, email, role, status, token, cookie: `${sessionCookieName(runtime.config)}=${token}` };
    },
    async stop() { await oidc.stop(); await store.stop(); },
  };
  return auth;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function cookiesFrom(response: Response): Map<string, string> {
  const jar = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index), decodeURIComponent(pair.slice(index + 1)));
  }
  return jar;
}
const cookieHeader = (jar: Map<string, string>) => [...jar].filter(([, value]) => value).map(([name, value]) => `${name}=${value}`).join("; ");

export interface SignInResult { status: number; location: string; cookie: string | null; setCookies: string[] }

/**
 * The whole browser flow with manual redirects: app sign-in route → provider
 * authorize → app callback (GET for Google, form POST for Apple) → session
 * cookie. `fetcher` is plain fetch for a running server, or the in-process
 * router below for route handler tests.
 */
export async function signIn(fetcher: Fetcher, base: string, provider: Provider, options: { next?: string; jar?: Map<string, string>; tamper?: (params: URLSearchParams) => void } = {}): Promise<SignInResult> {
  const jar = options.jar ?? new Map<string, string>();
  const start = await fetcher(`${base}/api/auth/signin/${provider}${options.next ? `?next=${encodeURIComponent(options.next)}` : ""}`, { redirect: "manual", headers: { cookie: cookieHeader(jar) } });
  for (const [name, value] of cookiesFrom(start)) jar.set(name, value);
  const authorizeUrl = start.headers.get("location");
  if (!authorizeUrl || start.status !== 303) return { status: start.status, location: authorizeUrl ?? "", cookie: null, setCookies: start.headers.getSetCookie() };
  const authorize = await fetch(authorizeUrl, { redirect: "manual" });
  let callback: Response;
  if (provider === "google") {
    const back = new URL(authorize.headers.get("location")!);
    options.tamper?.(back.searchParams);
    callback = await fetcher(back.toString(), { redirect: "manual", headers: { cookie: cookieHeader(jar) } });
  } else {
    const html = await authorize.text();
    const action = /action="([^"]+)"/.exec(html)![1];
    const form = new URLSearchParams();
    for (const match of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) form.set(match[1], match[2].replace(/&quot;/g, "\"").replace(/&amp;/g, "&"));
    options.tamper?.(form);
    callback = await fetcher(action, { method: "POST", redirect: "manual", body: form, headers: { cookie: cookieHeader(jar), "Content-Type": "application/x-www-form-urlencoded", origin: new URL(authorizeUrl).origin } });
  }
  const set = cookiesFrom(callback);
  for (const [name, value] of set) jar.set(name, value);
  const session = [...set].find(([name, value]) => name.endsWith("610_session") && value);
  return { status: callback.status, location: callback.headers.get("location") ?? "", cookie: session ? `${session[0]}=${session[1]}` : null, setCookies: callback.headers.getSetCookie() };
}

/** Sends `http://dashboard.test/api/...` requests to the real route handler modules, in this process. */
export function inProcessFetcher(base = "http://dashboard.test"): Fetcher {
  return async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.origin !== base) throw new Error(`in-process fetcher only serves ${base}, not ${url}`);
    const request = new Request(url, init);
    const method = (init.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
    const signin = /^\/api\/auth\/signin\/([^/]+)$/.exec(parsed.pathname);
    if (signin) return (await import("../../app/api/auth/signin/[provider]/route.ts")).GET(request, { params: Promise.resolve({ provider: signin[1] }) });
    const callback = /^\/api\/auth\/callback\/([^/]+)$/.exec(parsed.pathname);
    if (callback) {
      const route = await import("../../app/api/auth/callback/[provider]/route.ts");
      return route[method === "POST" ? "POST" : "GET"](request, { params: Promise.resolve({ provider: callback[1] }) });
    }
    throw new Error(`No in-process route for ${parsed.pathname}`);
  };
}

/** A same-origin request from a signed-in browser. */
export function asUser(user: Pick<TestUser, "cookie"> | null, url: string, init: RequestInit & { origin?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (user) headers.set("cookie", user.cookie);
  const origin = init.origin ?? new URL(url).origin;
  if (init.method && init.method !== "GET" && origin) headers.set("origin", origin);
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  return new Request(url, { ...init, headers });
}
