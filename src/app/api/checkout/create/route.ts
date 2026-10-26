import { z } from "zod";
import { CheckoutError, startCheckout } from "@/lib/orders";

const Body = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(10) }))
    .min(1)
    .max(20),
});

/** Called by the PayPal button's createOrder: prices the cart server-side and returns the PayPal order id. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Your cart looks invalid. Please refresh and try again." }, { status: 400 });

  try {
    const { paypalOrderId, orderNumber } = await startCheckout(parsed.data.items);
    return Response.json({ id: paypalOrderId, orderNumber });
  } catch (err) {
    if (err instanceof CheckoutError) return Response.json({ error: err.message }, { status: 400 });
    console.error("checkout/create failed", err);
    return Response.json({ error: "We couldn't start PayPal checkout. Please try again." }, { status: 502 });
  }
}
