// A stand-in for Google's OpenID Connect endpoints, as a real HTTP server:
// authorization (redirects straight back, as if the user picked an account),
// token exchange with the checks Google makes (client credentials, redirect
// URI, one-time codes, PKCE), and published signing keys. The app talks to it
// through AUTH_OIDC_ENDPOINT_OVERRIDE; nothing in the app knows it is a fake.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Provider = "google";
export interface FakeIdentity { sub: string; email?: string; emailVerified?: boolean; name?: string; picture?: string }

export const GOOGLE_CLIENT_ID = "fake-google-client.apps.googleusercontent.com";
export const GOOGLE_CLIENT_SECRET = "fake-google-secret-9d2c41";

/** How the next token exchange misbehaves (a forged or broken ID token, or an error). */
export type TokenFault = "bad-signature" | "wrong-audience" | "wrong-issuer" | "expired" | "wrong-nonce" | "alg-none" | "unknown-key" | "http-500" | "invalid-grant";

interface Grant { provider: Provider; identity: FakeIdentity; redirectUri: string; clientId: string; nonce?: string; challenge?: string; used: boolean }

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

export class FakeOidcProvider {
  private server: Server | undefined;
  private readonly google = generateKeyPairSync("rsa", { modulusLength: 2048 });
  /** A key the provider never published, for forged-token tests. */
  private readonly forger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  private readonly grants = new Map<string, Grant>();
  private readonly identities: Record<Provider, FakeIdentity> = {
    google: { sub: "google-default", email: "scout@example.org", emailVerified: true, name: "Default Scout" },
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
    return { AUTH_OIDC_ENDPOINT_OVERRIDE: this.origin, AUTH_GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET };
  }

  issuer(provider: Provider) { return `${this.origin}/${provider}`; }

  /** Signs an ID token exactly as the provider would (or deliberately wrong, for fault tests). */
  idToken(provider: Provider, claims: Record<string, unknown>, options: { alg?: string; kid?: string; key?: KeyObject } = {}): string {
    const alg = options.alg ?? "RS256";
    const header = b64url(JSON.stringify({ alg, kid: options.kid ?? `${provider}-key-1`, typ: "JWT" }));
    const payload = b64url(JSON.stringify(claims));
    if (alg === "none") return `${header}.${payload}.`;
    const key = options.key ?? this.google.privateKey;
    return `${header}.${payload}.${b64url(sign("sha256", Buffer.from(`${header}.${payload}`), key))}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", this.origin);
    const [, provider, endpoint] = url.pathname.split("/") as [string, Provider, string];
    const json = (status: number, body: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (provider !== "google") return json(404, { error: "not_found" });
    if (endpoint === "jwks") {
      const jwk = { ...this.google.publicKey.export({ format: "jwk" }), kid: `${provider}-key-1`, use: "sig", alg: "RS256" };
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
    if (url.searchParams.get("client_id") !== GOOGLE_CLIENT_ID || url.searchParams.get("response_type") !== "code") { response.writeHead(400); response.end("invalid_request"); return; }
    if (url.searchParams.get("code_challenge_method") !== "S256") { response.writeHead(400); response.end("PKCE required"); return; }
    const params: Record<string, string> = { state };
    if (this.denyNext) { this.denyNext = false; params.error = "access_denied"; }
    else {
      const code = b64url(randomBytes(18));
      this.grants.set(code, { provider, identity: { ...this.identities[provider] }, redirectUri, clientId: GOOGLE_CLIENT_ID, nonce: url.searchParams.get("nonce") ?? undefined, challenge: url.searchParams.get("code_challenge") ?? undefined, used: false });
      params.code = code;
    }
    const target = new URL(redirectUri);
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    response.writeHead(302, { Location: target.toString() }); response.end();
  }

  private token(provider: Provider, body: URLSearchParams, json: (status: number, body: unknown) => void) {
    this.tokenRequests.push({ provider, body });
    const fault = this.faults.shift();
    if (fault === "http-500") return json(500, { error: "server_error" });
    const grant = this.grants.get(body.get("code") ?? "");
    if (fault === "invalid-grant" || !grant || grant.used || grant.provider !== provider) return json(400, { error: "invalid_grant" });
    grant.used = true; // codes are single use
    if (body.get("redirect_uri") !== grant.redirectUri || body.get("client_id") !== grant.clientId) return json(400, { error: "invalid_grant" });
    if (body.get("client_secret") !== GOOGLE_CLIENT_SECRET) return json(401, { error: "invalid_client" });
    const verifier = body.get("code_verifier") ?? "";
    if (b64url(createHash("sha256").update(verifier).digest()) !== grant.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE verification failed" });

    const now = Math.floor(Date.now() / 1000);
    const { identity } = grant;
    const claims: Record<string, unknown> = {
      iss: fault === "wrong-issuer" ? "https://evil.example" : this.issuer(provider),
      aud: fault === "wrong-audience" ? "someone-elses-client" : grant.clientId,
      sub: identity.sub, iat: now, exp: fault === "expired" ? now - 3600 : now + 3600,
      nonce: fault === "wrong-nonce" ? "not-the-nonce" : grant.nonce,
      ...(identity.email ? { email: identity.email, email_verified: identity.emailVerified ?? true } : {}),
      ...(identity.name ? { name: identity.name } : {}),
      ...(identity.picture ? { picture: identity.picture } : {}),
    };
    let token: string;
    if (fault === "bad-signature") token = this.idToken(provider, claims, { key: this.forger });
    else if (fault === "alg-none") token = this.idToken(provider, claims, { alg: "none" });
    else if (fault === "unknown-key") token = this.idToken(provider, claims, { kid: "rotated-away" });
    else token = this.idToken(provider, claims);
    return json(200, { access_token: "fake-access-token", token_type: "Bearer", expires_in: 3600, id_token: token });
  }
}
