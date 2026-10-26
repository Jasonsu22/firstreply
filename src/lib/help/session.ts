/**
 * Buyer help sessions (PLAN.md §3.0): how a buyer proves which order they're asking about.
 *
 *   - Order number + email (widget, hosted page)  → verifyOrderNumberEmail
 *   - Signed per-order link (order emails, "Get help" in My orders) → createHelpLink / readHelpLink
 *
 * Either way the buyer gets a random session token that unlocks exactly one order. Only its sha256 is stored.
 * The token travels in an Authorization header (not a cookie) so the chat also works inside the widget's
 * iframe on the merchant's own domain, where third-party cookies are blocked.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import { buyers, chatSessions, merchants, orders } from "@/db/schema";
import { sha256 } from "@/lib/crypto";

const SESSION_HOURS = 24;
const LINK_DAYS = 60;

export type Door = (typeof chatSessions.$inferInsert)["door"];
export type ChatSession = typeof chatSessions.$inferSelect;

function linkKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing ENCRYPTION_KEY");
  return createHash("sha256").update(`help-link:${raw}`).digest();
}

function signLink(payload: string) {
  return createHmac("sha256", linkKey()).update(payload).digest("base64url");
}

/** A link token for one order: `<orderId>.<expiry>.<signature>`. Goes in order emails and the store's "Get help" button. */
export function createHelpLink(orderId: string, now = new Date()): string {
  const payload = `${orderId}.${Math.floor(now.getTime() / 1000) + LINK_DAYS * 86400}`;
  return `${payload}.${signLink(payload)}`;
}

/** Returns the order id if the link token is genuine and not expired. */
export function readHelpLink(
  token: string,
  now = new Date(),
): string | undefined {
  const [orderId, exp, signature] = token.split(".");
  if (!orderId || !exp || !signature || !/^[0-9a-f-]{36}$/i.test(orderId))
    return undefined;
  const expected = Buffer.from(signLink(`${orderId}.${exp}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return undefined;
  return Number(exp) * 1000 > now.getTime() ? orderId : undefined;
}

export async function getMerchantBySlug(slug: string) {
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.slug, slug));
  return merchant;
}

/** Order number + email must both match a paid order of this store. */
export async function verifyOrderNumberEmail(
  merchantId: string,
  orderNumber: string,
  email: string,
) {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(buyers, eq(buyers.id, orders.buyerId))
    .where(
      and(
        eq(orders.merchantId, merchantId),
        eq(orders.orderNumber, orderNumber.trim().toUpperCase()),
        eq(buyers.email, email.trim()), // citext: case-insensitive
        ne(orders.status, "created"),
      ),
    );
  return row?.id;
}

/** Starts a chat session for one order. The token is returned to the client once and never stored. */
export async function startChatSession(input: {
  merchantId: string;
  orderId: string;
  door: Door;
  verifiedBy: ChatSession["verifiedBy"];
  ip?: string;
}) {
  const token = randomBytes(32).toString("base64url");
  const [session] = await db
    .insert(chatSessions)
    .values({
      merchantId: input.merchantId,
      orderId: input.orderId,
      door: input.door,
      verifiedBy: input.verifiedBy,
      tokenHash: sha256(token),
      ipHash: input.ip ? sha256(`ip:${input.ip}`) : null,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000),
    })
    .returning();
  return { token, session };
}

/** Finds the live session for a request's `Authorization: Bearer <token>` header. */
export async function sessionFromRequest(
  request: Request,
): Promise<ChatSession | undefined> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return undefined;
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.tokenHash, sha256(token)),
        gt(chatSessions.expiresAt, new Date()),
      ),
    );
  return session;
}

export async function touchSession(sessionId: string, caseId?: string) {
  await db
    .update(chatSessions)
    .set({ lastActiveAt: new Date(), ...(caseId && { caseId }) })
    .where(eq(chatSessions.id, sessionId));
}

// ── Rate limiting for wrong order number / email guesses ─────────────────────
// In memory: fine for one server instance (the hackathon deploy). A shared store would be needed for more.

const failures = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 8;

export function tooManyFailures(ip: string): boolean {
  const recent = (failures.get(ip) ?? []).filter(
    (t) => Date.now() - t < WINDOW_MS,
  );
  failures.set(ip, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(ip: string) {
  failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}
