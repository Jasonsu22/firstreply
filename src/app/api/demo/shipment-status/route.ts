import { z } from "zod";
import { ToolkitError } from "@/lib/paypal/toolkit";
import { setShipmentStatus, ShippingError } from "@/lib/shipping";

const Body = z.object({
  shipmentId: z.string().uuid(),
  status: z.enum(["shipped", "on_hold", "delivered", "cancelled", "lost"]),
});

/** Demo panel: change a shipment's tracking status (updates the PayPal tracker). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid shipment or status." }, { status: 400 });
  try {
    const shipment = await setShipmentStatus(parsed.data.shipmentId, parsed.data.status);
    return Response.json({ shipment });
  } catch (err) {
    if (err instanceof ShippingError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof ToolkitError) return Response.json({ error: `PayPal rejected the update: ${JSON.stringify(err.detail)}` }, { status: 502 });
    console.error("demo/shipment-status failed", err);
    return Response.json({ error: "Couldn't update the shipment." }, { status: 500 });
  }
}
