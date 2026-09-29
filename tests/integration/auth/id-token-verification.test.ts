// ID token verification against a provider's published keys, for the edge
// cases a real provider (or an attacker) can produce. Tokens are signed by the
// fake provider's own keys, or deliberately not.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { appleClientSecret, clearJwksCache, TokenError, verifyIdToken } from "../../../lib/auth/sign-in.ts";
import { FakeOidcProvider, GOOGLE_CLIENT_ID } from "../../helpers/fake-oidc.ts";

let oidc: FakeOidcProvider;
before(async () => { oidc = new FakeOidcProvider(); await oidc.start(); });
beforeEach(() => clearJwksCache());
after(async () => { await oidc.stop(); });

const now = () => Math.floor(Date.now() / 1000);
const claims = (extra: Record<string, unknown> = {}) => ({ iss: oidc.issuer("google"), aud: GOOGLE_CLIENT_ID, sub: "subject-1", iat: now(), exp: now() + 600, nonce: "n-1", ...extra });
const verify = (token: string, options: Partial<Parameters<typeof verifyIdToken>[1]> = {}) => verifyIdToken(token, { jwksUri: `${oidc.issuer("google")}/jwks`, issuers: [oidc.issuer("google")], audience: GOOGLE_CLIENT_ID, nonce: "n-1", ...options });
const rejects = async (token: string, message: RegExp, options?: Partial<Parameters<typeof verifyIdToken>[1]>) => assert.rejects(verify(token, options), (error: unknown) => error instanceof TokenError && message.test(error.message));

test("a correctly signed token for this client is accepted and its claims returned", async () => {
  const result = await verify(oidc.idToken("google", claims({ email: "a@b.c" })));
  assert.equal(result.sub, "subject-1");
  assert.equal(result.email, "a@b.c");
});

test("time claims: expired, not yet valid, and issued in the future are rejected (60 s skew allowed)", async () => {
  await rejects(oidc.idToken("google", claims({ exp: now() - 61 })), /expired/);
  await verify(oidc.idToken("google", claims({ exp: now() - 30 })));
  await rejects(oidc.idToken("google", claims({ nbf: now() + 300 })), /not valid yet/);
  await rejects(oidc.idToken("google", claims({ iat: now() + 300 })), /future/);
  await rejects(oidc.idToken("google", claims({ exp: "tomorrow" })), /expired/);
});

test("audience: multi-audience tokens need azp to be this client", async () => {
  await rejects(oidc.idToken("google", claims({ aud: [GOOGLE_CLIENT_ID, "other"] })), /another application/);
  await verify(oidc.idToken("google", claims({ aud: [GOOGLE_CLIENT_ID, "other"], azp: GOOGLE_CLIENT_ID })));
  await rejects(oidc.idToken("google", claims({ aud: "other" })), /another application/);
});

test("subject, nonce, and issuer must be present and match", async () => {
  await rejects(oidc.idToken("google", claims({ sub: "" })), /subject/);
  await rejects(oidc.idToken("google", claims({ sub: "x".repeat(300) })), /subject/);
  await rejects(oidc.idToken("google", claims({ nonce: undefined })), /nonce/);
  await rejects(oidc.idToken("google", claims({ iss: "https://accounts.google.com.evil" })), /issuer/);
});

test("structure and algorithms: malformed, alg=none, HS256, wrong key type, and unknown keys are rejected", async () => {
  for (const bad of ["", "a.b", "a.b.c.d", "!!!.???.***", "x".repeat(20_000)]) await rejects(bad, /Malformed/);
  await rejects(oidc.idToken("google", claims(), { alg: "none" }), /algorithm/);
  await rejects(oidc.idToken("google", claims(), { alg: "HS256" }), /algorithm/);
  // An ES256 token presenting Google's RSA key id: the key type does not match the algorithm.
  await rejects(oidc.idToken("google", claims(), { alg: "ES256", key: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey }), /Unknown signing key/);
  await rejects(oidc.idToken("google", claims(), { kid: "never-published" }), /Unknown signing key/);
  await rejects(oidc.idToken("google", claims(), { key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey }), /signature/);
});

test("key fetching: an unreachable key endpoint is an error, not an acceptance", async () => {
  await rejects(oidc.idToken("google", claims()), /Signing keys unavailable/, { jwksUri: `${oidc.issuer("google")}/missing` });
});

test("Apple client secret: a five-minute ES256 JWT from the team for the Services ID", () => {
  const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const secret = appleClientSecret({ teamId: "TEAM", keyId: "KEY", privateKey: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, "org.example.web", "https://appleid.apple.com", 1_700_000_000_000);
  const [header, payload] = secret.split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
  assert.deepEqual(header, { alg: "ES256", kid: "KEY" });
  assert.deepEqual(payload, { iss: "TEAM", iat: 1_700_000_000, exp: 1_700_000_300, aud: "https://appleid.apple.com", sub: "org.example.web" });
});
