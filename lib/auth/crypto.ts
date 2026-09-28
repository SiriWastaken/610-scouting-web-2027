import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const base64url = (buffer: Buffer | Uint8Array) => Buffer.from(buffer).toString("base64url");
export const randomToken = (bytes = 32) => base64url(randomBytes(bytes));
export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const keyFor = (secret: string, purpose: string) => createHash("sha256").update(`${purpose}\0${secret}`).digest();

/**
 * Encrypts and authenticates a small JSON value (AES-256-GCM) for a cookie the
 * browser must carry but can neither read nor alter, such as OAuth state and
 * the PKCE verifier. `purpose` binds the value to one use.
 */
export function seal(value: unknown, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return base64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

export function unseal<T>(token: string | undefined, secret: string, purpose: string): T | null {
  if (!token || token.length > 4096) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { return null; }
}

/** PKCE S256 challenge for a verifier. */
export const pkceChallenge = (verifier: string) => base64url(createHash("sha256").update(verifier).digest());
