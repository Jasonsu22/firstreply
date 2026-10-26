import { z } from "zod";
import { setBuyerSession } from "@/lib/buyer-session";
import { CheckoutError, completeCheckout } from "@/lib/orders";

const Body = z.object({ paypalOrderId: z.string().regex(/^[A-Z0-9]{10,32}$/) });

/** Called by the PayPal button's onApprove: captures the payment and remembers the buyer for "My orders". */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid PayPal order id." }, { status: 400 });

  try {
    const { orderNumber, buyerId } = await completeCheckout(parsed.data.paypalOrderId);
    await setBuyerSession(buyerId);
    return Response.json({ orderNumber });
  } catch (err) {
    if (err instanceof CheckoutError) return Response.json({ error: err.message }, { status: 400 });
    console.error("checkout/capture failed", err);
    return Response.json({ error: "Payment approved, but we couldn't finish the order. Please contact the store." }, { status: 502 });
  }
}
