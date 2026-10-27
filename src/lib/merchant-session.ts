/**
 * Merchant console sign-in. The cookie holds `<userId>.<expiry>.<signature>` (HMAC), so it can't be forged
 * or extended; the user row is looked up on every request, so deleting a user signs them out.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { merchants, merchantUsers } from "@/db/schema";

export const MERCHANT_COOKIE = "fr_merchant";
const SESSION_DAYS = 7;

function signingKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing ENCRYPTION_KEY");
  return createHash("sha256").update(`merchant-session:${raw}`).digest();
}

function sign(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export async function startMerchantSession(userId: string) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400}`;
  (await cookies()).set(MERCHANT_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endMerchantSession() {
  (await cookies()).delete(MERCHANT_COOKIE);
}

export type MerchantSession = { userId: string; email: string; role: string; merchantId: string; merchantName: string; merchantSlug: string };

/** The signed-in merchant user, or undefined. */
export async function getMerchantSession(): Promise<MerchantSession | undefined> {
  const value = (await cookies()).get(MERCHANT_COOKIE)?.value;
  const [userId, exp, signature] = value?.split(".") ?? [];
  if (!userId || !exp || !signature || !/^[0-9a-f-]{36}$/i.test(userId)) return undefined;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || Number(exp) * 1000 < Date.now()) return undefined;

  const [row] = await db
    .select({ userId: merchantUsers.id, email: merchantUsers.email, role: merchantUsers.role, merchantId: merchants.id, merchantName: merchants.name, merchantSlug: merchants.slug })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchants.id, merchantUsers.merchantId))
    .where(eq(merchantUsers.id, userId));
  return row;
}

/** For console pages and API routes: the signed-in merchant, or a redirect to the sign-in page. */
export async function requireMerchant(): Promise<MerchantSession> {
  const session = await getMerchantSession();
  if (!session) redirect("/console/login");
  return session;
}

/** Checks an email + password. Returns the user id, or undefined (same answer for unknown email and wrong password). */
export async function checkPassword(email: string, password: string): Promise<string | undefined> {
  const [user] = await db.select().from(merchantUsers).where(eq(merchantUsers.email, email.trim()));
  if (!user) return undefined;
  return (await verify(user.passwordHash, password)) ? user.id : undefined;
}

/** Judges can open the demo console without the password when DEMO_CONSOLE_OPEN=true (sandbox only). */
export function demoConsoleOpen() {
  return process.env.DEMO_CONSOLE_OPEN === "true";
}
