import { z } from "zod";
import { clientIp, getMerchantBySlug, recordFailure, startChatSession, tooManyFailures, verifyOrderNumberEmail } from "@/lib/help/session";
import { loadChatState } from "@/lib/help/state";

const Body = z.object({
  shop: z.string().min(1).max(64),
  orderNumber: z.string().min(3).max(32),
  email: z.string().email().max(254),
  door: z.enum(["widget", "hosted_page"]).default("hosted_page"),
});

/** Doors 1 and 4: the buyer proves the order with its number and the email they paid with. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please enter your order number and email." }, { status: 400 });

  const ip = clientIp(request);
  if (tooManyFailures(ip)) return Response.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });

  const merchant = await getMerchantBySlug(parsed.data.shop);
  const orderId = merchant && (await verifyOrderNumberEmail(merchant.id, parsed.data.orderNumber, parsed.data.email));
  if (!merchant || !orderId) {
    recordFailure(ip);
    // Same message either way, so the form can't be used to find out which orders or emails exist.
    return Response.json({ error: "We couldn't find an order with that number and email." }, { status: 404 });
  }

  const { token, session } = await startChatSession({ merchantId: merchant.id, orderId, door: parsed.data.door, verifiedBy: "order_number_email", ip });
  return Response.json({ token, state: await loadChatState(session) });
}
