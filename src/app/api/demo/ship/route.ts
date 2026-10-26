import { z } from "zod";
import { ToolkitError } from "@/lib/paypal/toolkit";
import { ShippingError, shipOrder } from "@/lib/shipping";

const Body = z.object({ orderId: z.string().uuid() });

/** Demo panel: mark an order shipped (adds a UPS tracker in PayPal). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid order id." }, { status: 400 });
  try {
    const shipment = await shipOrder(parsed.data.orderId);
    return Response.json({ shipment });
  } catch (err) {
    if (err instanceof ShippingError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof ToolkitError) return Response.json({ error: `PayPal rejected the tracker: ${JSON.stringify(err.detail)}` }, { status: 502 });
    console.error("demo/ship failed", err);
    return Response.json({ error: "Couldn't ship the order." }, { status: 500 });
  }
}
