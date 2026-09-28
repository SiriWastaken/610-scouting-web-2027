// A stand-in for Google's and Apple's OpenID Connect endpoints, as a real HTTP
// server: authorization (redirects straight back, as if the user picked an
// account), token exchange with the checks the real providers make (client
// credentials, redirect URI, one-time codes, PKCE for Google, Apple's ES256
// client-secret JWT), and published signing keys. The app talks to it through
// AUTH_OIDC_ENDPOINT_OVERRIDE; nothing in the app knows it is a fake.
import { createHash, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Provider = "google" | "apple";
export interface FakeIdentity { sub: string; email?: string; emailVerified?: boolean; name?: string; picture?: string }

export const GOOGLE_CLIENT_ID = "fake-google-client.apps.googleusercontent.com";
export const GOOGLE_CLIENT_SECRET = "fake-google-secret-9d2c41";
export const APPLE_CLIENT_ID = "org.team610.scouting.fake";
export const APPLE_TEAM_ID = "FAKETEAM01";
export const APPLE_KEY_ID = "FAKEKEY001";

/** How the next token exchange misbehaves (a forged or broken ID token, or an error). */
export type TokenFault = "bad-signature" | "wrong-audience" | "wrong-issuer" | "expired" | "wrong-nonce" | "alg-none" | "unknown-key" | "http-500" | "invalid-grant";

interface Grant { provider: Provider; identity: FakeIdentity; redirectUri: string; clientId: string; nonce?: string; challenge?: string; used: boolean }

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export class FakeOidcProvider {
  private server: Server | undefined;
  private readonly google = generateKeyPairSync("rsa", { modulusLength: 2048 });
  private readonly apple = generateKeyPairSync("ec", { namedCurve: "P-256" });
  /** The key the app signs Apple client secrets with; the fake checks those signatures with its public half. */
  readonly appleClientKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
  /** Keys the provider never published, for forged-token tests. */
  private readonly forger = { google: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey, apple: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey };
  private readonly grants = new Map<string, Grant>();
  private readonly identities: Record<Provider, FakeIdentity> = {
    google: { sub: "google-default", email: "scout@example.org", emailVerified: true, name: "Default Scout" },
    apple: { sub: "apple-default", email: "scout@privaterelay.appleid.com", emailVerified: true },
  };
  private faults: TokenFault[] = [];
  /** Set to make the authorization endpoint report that the user cancelled. */
  denyNext = false;
  tokenRequests: Array<{ provider: Provider; body: URLSearchParams }> = [];
  authorizeRequests: URL[] = [];

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      // A bug in the fake must fail loudly, not leave the app waiting for a timeout.
      this.handle(request, response).catch((error: unknown) => { if (!response.headersSent) { response.writeHead(500); response.end(String(error)); } });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    return this.origin;
  }
  get origin() { return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`; }
  async stop() { this.server?.closeAllConnections(); await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve()); }

  /** Who the next sign-in with `provider` is (as if they chose this account at the provider). */
  setIdentity(provider: Provider, identity: FakeIdentity) { this.identities[provider] = identity; }
  fault(fault: TokenFault) { this.faults.push(fault); }

  /** Environment that points the app at this provider. */
  appEnv(): Record<string, string> {
    return {
      AUTH_OIDC_ENDPOINT_OVERRIDE: this.origin,
      AUTH_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET,
      AUTH_APPLE_CLIENT_ID: APPLE_CLIENT_ID, AUTH_APPLE_TEAM_ID: APPLE_TEAM_ID, AUTH_APPLE_KEY_ID: APPLE_KEY_ID,
      AUTH_APPLE_PRIVATE_KEY: this.appleClientKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n"),
    };
  }

  issuer(provider: Provider) { return `${this.origin}/${provider}`; }

  /** Signs an ID token exactly as the provider would (or deliberately wrong, for fault tests). */
  idToken(provider: Provider, claims: Record<string, unknown>, options: { alg?: string; kid?: string; key?: KeyObject } = {}): string {
    const alg = options.alg ?? (provider === "google" ? "RS256" : "ES256");
    const header = b64url(JSON.stringify({ alg, kid: options.kid ?? `${provider}-key-1`, typ: "JWT" }));
    const payload = b64url(JSON.stringify(claims));
    if (alg === "none") return `${header}.${payload}.`;
    const key = options.key ?? (provider === "google" ? this.google.privateKey : this.apple.privateKey);
    const signature = sign("sha256", Buffer.from(`${header}.${payload}`), provider === "google" ? key : { key, dsaEncoding: "ieee-p1363" });
    return `${header}.${payload}.${b64url(signature)}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", this.origin);
    const [, provider, endpoint] = url.pathname.split("/") as [string, Provider, string];
    const json = (status: number, body: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (provider !== "google" && provider !== "apple") return json(404, { error: "not_found" });
    if (endpoint === "jwks") {
      const jwk = { ...(provider === "google" ? this.google.publicKey : this.apple.publicKey).export({ format: "jwk" }), kid: `${provider}-key-1`, use: "sig", alg: provider === "google" ? "RS256" : "ES256" };
      return json(200, { keys: [jwk] });
    }
    if (endpoint === "authorize") return this.authorize(provider, url, response);
    if (endpoint === "token" && request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      return this.token(provider, new URLSearchParams(raw), json);
    }
    return json(404, { error: "not_found" });
  }

  private authorize(provider: Provider, url: URL, response: ServerResponse) {
    this.authorizeRequests.push(url);
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const expectedClient = provider === "google" ? GOOGLE_CLIENT_ID : APPLE_CLIENT_ID;
    if (url.searchParams.get("client_id") !== expectedClient || url.searchParams.get("response_type") !== "code") { response.writeHead(400); response.end("invalid_request"); return; }
    if (provider === "google" && url.searchParams.get("code_challenge_method") !== "S256") { response.writeHead(400); response.end("PKCE required"); return; }
    const params: Record<string, string> = { state };
    if (this.denyNext) { this.denyNext = false; params.error = provider === "google" ? "access_denied" : "user_cancelled_authorize"; }
    else {
      const code = b64url(randomBytes(18));
      this.grants.set(code, { provider, identity: { ...this.identities[provider] }, redirectUri, clientId: expectedClient, nonce: url.searchParams.get("nonce") ?? undefined, challenge: url.searchParams.get("code_challenge") ?? undefined, used: false });
      params.code = code;
      const name = this.identities.apple.name?.split(" ");
      if (provider === "apple" && name) params.user = JSON.stringify({ name: { firstName: name[0], lastName: name.slice(1).join(" ") }, email: this.identities.apple.email });
    }
    if (provider === "google") {
      const target = new URL(redirectUri);
      for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
      response.writeHead(302, { Location: target.toString() }); response.end();
      return;
    }
    // Apple's form_post: an auto-submitting form that POSTs back to the app.
    const inputs = Object.entries(params).map(([key, value]) => `<input type="hidden" name="${key}" value="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`).join("");
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><title>Apple</title><form method="POST" action="${redirectUri}">${inputs}</form><script>document.forms[0].submit()</script>`);
  }

  /** Apple requires its client secret to be an ES256 JWT from the team's key, for this client, not expired. */
  private validAppleSecret(secret: string | null): boolean {
    const [header, payload, signature] = (secret ?? "").split(".");
    if (!header || !payload || !signature) return false;
    try { return this.checkAppleSecret(header, payload, signature); } catch { return false; }
  }

  private checkAppleSecret(header: string, payload: string, signature: string): boolean {
    const ok = verify("sha256", Buffer.from(`${header}.${payload}`), { key: this.appleClientKey.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    const head = JSON.parse(Buffer.from(header, "base64url").toString()) as Record<string, unknown>;
    return ok && head.kid === APPLE_KEY_ID && claims.iss === APPLE_TEAM_ID && claims.sub === APPLE_CLIENT_ID && claims.aud === this.issuer("apple") && Number(claims.exp) > Date.now() / 1000;
  }

  private token(provider: Provider, body: URLSearchParams, json: (status: number, body: unknown) => void) {
    this.tokenRequests.push({ provider, body });
    const fault = this.faults.shift();
    if (fault === "http-500") return json(500, { error: "server_error" });
    const grant = this.grants.get(body.get("code") ?? "");
    if (fault === "invalid-grant" || !grant || grant.used || grant.provider !== provider) return json(400, { error: "invalid_grant" });
    grant.used = true; // codes are single use
    if (body.get("redirect_uri") !== grant.redirectUri || body.get("client_id") !== grant.clientId) return json(400, { error: "invalid_grant" });
    if (provider === "google") {
      if (body.get("client_secret") !== GOOGLE_CLIENT_SECRET) return json(401, { error: "invalid_client" });
      const verifier = body.get("code_verifier") ?? "";
      if (b64url(createHash("sha256").update(verifier).digest()) !== grant.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
    } else if (!this.validAppleSecret(body.get("client_secret"))) return json(400, { error: "invalid_client" });

    const now = Math.floor(Date.now() / 1000);
    const { identity } = grant;
    const claims: Record<string, unknown> = {
      iss: fault === "wrong-issuer" ? "https://evil.example" : this.issuer(provider),
      aud: fault === "wrong-audience" ? "someone-elses-client" : grant.clientId,
      sub: identity.sub, iat: now, exp: fault === "expired" ? now - 3600 : now + 3600,
      nonce: fault === "wrong-nonce" ? "not-the-nonce" : grant.nonce,
      ...(identity.email ? { email: identity.email, email_verified: provider === "apple" ? String(identity.emailVerified ?? true) : identity.emailVerified ?? true } : {}),
      ...(provider === "google" && identity.name ? { name: identity.name } : {}),
      ...(provider === "google" && identity.picture ? { picture: identity.picture } : {}),
    };
    let token: string;
    if (fault === "bad-signature") token = this.idToken(provider, claims, { key: this.forger[provider] });
    else if (fault === "alg-none") token = this.idToken(provider, claims, { alg: "none" });
    else if (fault === "unknown-key") token = this.idToken(provider, claims, { kid: "rotated-away" });
    else token = this.idToken(provider, claims);
    return json(200, { access_token: "fake-access-token", token_type: "Bearer", expires_in: 3600, id_token: token });
  }
}
