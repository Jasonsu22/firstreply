/**
 * AES-256-GCM encryption for secrets stored in the database (e.g. a merchant's PayPal client secret).
 * Stored format: 12-byte IV | 16-byte auth tag | ciphertext.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing ENCRYPTION_KEY (generate one with: openssl rand -base64 32)");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function encryptSecret(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(stored: Buffer): string {
  const iv = stored.subarray(0, 12);
  const tag = stored.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]).toString("utf8");
}

/** One-way hash for values we only ever compare (chat tokens, normalized addresses). */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
