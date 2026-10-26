/**
 * Shipments: our row mirrors a PayPal order tracker (PayPal is where buyers and dispute
 * reviewers see tracking). Sandbox carriers never move parcels, so the demo panel sets the status.
 *
 * Note for the agent's tracking tool: PayPal's get-tracking returns one record per update for the
 * same tracking number (e.g. DELIVERY_SCHEDULED, then ON_HOLD). Use the one with the latest last_updated_time.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, shipments } from "@/db/schema";
import { runToolkitTool } from "@/lib/paypal/toolkit";

export type ShipmentStatus = (typeof shipments.$inferSelect)["status"];

// PayPal has no "lost" status: a lost parcel stays ON_HOLD in PayPal and is marked lost on our side.
const PAYPAL_STATUS: Record<ShipmentStatus, string> = {
  shipped: "SHIPPED",
  on_hold: "ON_HOLD",
  delivered: "DELIVERED",
  cancelled: "CANCELLED",
  lost: "ON_HOLD",
};

export class ShippingError extends Error {}

export async function shipOrder(orderId: string, carrier = "UPS") {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order?.paypalOrderId || !order.paypalCaptureId) throw new ShippingError("Only paid orders can be shipped.");
  const [existing] = await db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.shippedAt));
  if (existing && !existing.isReship) throw new ShippingError(`Already shipped (${existing.carrier} ${existing.trackingNumber}).`);

  const trackingNumber = `1Z${Date.now().toString().slice(-12)}`;
  await runToolkitTool("create_shipment_tracking", {
    order_id: order.paypalOrderId,
    transaction_id: order.paypalCaptureId,
    tracking_number: trackingNumber,
    carrier,
    status: "SHIPPED",
  });

  const [shipment] = await db
    .insert(shipments)
    .values({
      orderId,
      carrier,
      trackingNumber,
      paypalTrackerId: `${order.paypalCaptureId}-${trackingNumber}`,
      status: "shipped",
    })
    .returning();
  return shipment;
}

export async function setShipmentStatus(shipmentId: string, status: ShipmentStatus) {
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment) throw new ShippingError("Shipment not found.");
  const [order] = await db.select().from(orders).where(eq(orders.id, shipment.orderId));
  if (!order?.paypalCaptureId) throw new ShippingError("Order has no PayPal capture.");

  if (PAYPAL_STATUS[status] !== PAYPAL_STATUS[shipment.status]) {
    await runToolkitTool("update_shipment_tracking", {
      transaction_id: order.paypalCaptureId,
      tracking_number: shipment.trackingNumber,
      status: PAYPAL_STATUS[status],
      carrier: shipment.carrier,
    });
  }

  const now = new Date();
  const [updated] = await db
    .update(shipments)
    .set({ status, lastStatusAt: now, deliveredAt: status === "delivered" ? now : null })
    .where(eq(shipments.id, shipmentId))
    .returning();
  return updated;
}
