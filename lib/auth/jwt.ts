// The small part of JOSE the sign-in flow needs, on node:crypto: verifying a
// provider's ID token against its published keys (RS256 for Google, RS256/ES256
// for Apple), and signing Apple's ES256 client secret.
import { createPublicKey, createPrivateKey, sign, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import { base64url } from "./crypto.ts";

export interface JwtClaims { iss?: unknown; aud?: unknown; sub?: unknown; exp?: unknown; iat?: unknown; nbf?: unknown; nonce?: unknown; [claim: string]: unknown }

export class TokenError extends Error {}

const ALGORITHMS: Record<string, { hash: string; kty: string; dsaEncoding?: "ieee-p1363" }> = {
  RS256: { hash: "sha256", kty: "RSA" },
  ES256: { hash: "sha256", kty: "EC", dsaEncoding: "ieee-p1363" },
};

interface CachedKeys { keys: Map<string, { key: KeyObject; kty: string }>; fetchedAt: number }
const jwksCache = new Map<string, CachedKeys>();
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_REFRESH_FLOOR_MS = 30 * 1000;

async function loadKeys(jwksUri: string, force: boolean): Promise<CachedKeys> {
  const cached = jwksCache.get(jwksUri);
  if (cached && (!force || Date.now() - cached.fetchedAt < JWKS_REFRESH_FLOOR_MS) && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached;
  const response = await fetch(jwksUri, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new TokenError(`Signing keys unavailable (HTTP ${response.status})`);
  const body = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys = new Map<string, { key: KeyObject; kty: string }>();
  for (const jwk of body.keys ?? []) {
    if (typeof jwk.kid !== "string" || (jwk.use !== undefined && jwk.use !== "sig")) continue;
    try { keys.set(jwk.kid, { key: createPublicKey({ key: jwk, format: "jwk" }), kty: String(jwk.kty) }); } catch { /* skip unusable keys */ }
  }
  const entry = { keys, fetchedAt: Date.now() };
  jwksCache.set(jwksUri, entry);
  return entry;
}

function decodeSegment<T>(segment: string): T {
  try { return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T; } catch { throw new TokenError("Malformed token"); }
}

export interface VerifyOptions { jwksUri: string; issuers: string[]; audience: string; nonce?: string; clockSkewSeconds?: number; now?: number }

/** Verifies signature, issuer, audience, expiry, and nonce. Throws TokenError on any failure. */
export async function verifyIdToken(token: string, options: VerifyOptions): Promise<JwtClaims> {
  if (typeof token !== "string" || token.length > 16_384) throw new TokenError("Malformed token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenError("Malformed token");
  const header = decodeSegment<{ alg?: unknown; kid?: unknown }>(parts[0]);
  const algorithm = typeof header.alg === "string" ? ALGORITHMS[header.alg] : undefined;
  // "none" and HMAC algorithms are never accepted: the key must be the provider's published public key.
  if (!algorithm || typeof header.kid !== "string") throw new TokenError("Unsupported token algorithm");
  let entry = (await loadKeys(options.jwksUri, false)).keys.get(header.kid);
  if (!entry) entry = (await loadKeys(options.jwksUri, true)).keys.get(header.kid); // keys rotate
  if (!entry || entry.kty !== algorithm.kty) throw new TokenError("Unknown signing key");
  const valid = verify(algorithm.hash, Buffer.from(`${parts[0]}.${parts[1]}`), { key: entry.key, dsaEncoding: algorithm.dsaEncoding }, Buffer.from(parts[2], "base64url"));
  if (!valid) throw new TokenError("Invalid token signature");

  const claims = decodeSegment<JwtClaims>(parts[1]);
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (typeof claims.iss !== "string" || !options.issuers.includes(claims.iss)) throw new TokenError("Unexpected token issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) throw new TokenError("Token was issued for another application");
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== options.audience) throw new TokenError("Token was issued for another application");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new TokenError("Token has expired");
  if (typeof claims.nbf === "number" && claims.nbf - skew > now) throw new TokenError("Token is not valid yet");
  if (typeof claims.iat === "number" && claims.iat - skew > now) throw new TokenError("Token was issued in the future");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new TokenError("Token has no subject");
  if (options.nonce !== undefined && claims.nonce !== options.nonce) throw new TokenError("Token nonce does not match this sign-in");
  return claims;
}

/** Apple's client secret: an ES256 JWT signed with the team's Sign in with Apple key, valid for five minutes. */
export function appleClientSecret(apple: { teamId: string; keyId: string; privateKey: string }, clientId: string, audience: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: apple.keyId })));
  const payload = base64url(Buffer.from(JSON.stringify({ iss: apple.teamId, iat, exp: iat + 300, aud: audience, sub: clientId })));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key: createPrivateKey(apple.privateKey), dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${base64url(signature)}`;
}

/** Test/diagnostic hook: forget cached provider keys. */
export function clearJwksCache() { jwksCache.clear(); }
