import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { clientIp, readHelpLink, startChatSession } from "@/lib/help/session";
import { loadChatState } from "@/lib/help/state";

const Body = z.object({
  link: z.string().min(10).max(200),
  door: z.enum(["email_link", "widget", "statement"]).default("email_link"),
});

/** Door 2: a signed per-order link (order emails, "Get help" in My orders) opens the chat with no typing. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  const orderId = parsed.success ? readHelpLink(parsed.data.link) : undefined;
  if (!parsed.success || !orderId) return Response.json({ error: "This help link has expired. Please enter your order number and email instead." }, { status: 401 });

  const [order] = await db.select({ merchantId: orders.merchantId }).from(orders).where(eq(orders.id, orderId));
  if (!order) return Response.json({ error: "Order not found." }, { status: 404 });

  const { token, session } = await startChatSession({ merchantId: order.merchantId, orderId, door: parsed.data.door, verifiedBy: "signed_link", ip: clientIp(request) });
  return Response.json({ token, state: await loadChatState(session) });
}
