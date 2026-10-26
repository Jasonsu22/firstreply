/**
 * Remembers which buyer is using the demo store, so "My orders" can list their orders.
 * The cookie holds the buyer id plus an HMAC signature — it can't be edited to see someone else's orders.
 * (The help chat on day 6 uses its own per-order tokens instead.)
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const BUYER_COOKIE = "fr_buyer";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function signingKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing ENCRYPTION_KEY");
  // Derive a separate key so the encryption key is never used for signing directly.
  return createHash("sha256").update(`buyer-session:${raw}`).digest();
}

function sign(buyerId: string): string {
  return createHmac("sha256", signingKey()).update(buyerId).digest("base64url");
}

export async function setBuyerSession(buyerId: string) {
  (await cookies()).set(BUYER_COOKIE, `${buyerId}.${sign(buyerId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Returns the signed-in buyer's id, or undefined if there's no valid cookie. */
export async function getBuyerSession(): Promise<string | undefined> {
  const value = (await cookies()).get(BUYER_COOKIE)?.value;
  if (!value) return undefined;
  const [buyerId, signature] = value.split(".");
  if (!buyerId || !signature) return undefined;
  const expected = Buffer.from(sign(buyerId));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? buyerId : undefined;
}
