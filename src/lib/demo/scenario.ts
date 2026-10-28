/**
 * Demo panel: create a local scenario order (no PayPal capture) so judges can
 * open help chat without running a sandbox checkout first.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buyers, orderItems, orders, products, shipments } from "@/db/schema";
import { DEMO_SLUG } from "@/lib/demo/seed-store";
import { getDemoMerchant } from "@/lib/store";

export type ScenarioKind = "stuck_parcel" | "delivered_ok";

export type ScenarioResult = {
  orderId: string;
  orderNumber: string;
  buyerEmail: string;
  buyerName: string | null;
  amountCents: number;
  shipmentStatus: string;
  helpPath: string;
};

export async function createScenarioOrder(kind: ScenarioKind): Promise<ScenarioResult> {
  const merchant = await getDemoMerchant();
  if (merchant.slug !== DEMO_SLUG) throw new Error("Scenarios are only available for the demo store.");

  const [buyer] = await db
    .select()
    .from(buyers)
    .where(and(eq(buyers.merchantId, merchant.id), eq(buyers.email, "maya.chen@example.com")))
    .limit(1);
  if (!buyer) throw new Error("Demo buyer Maya Chen is missing — run npm run db:seed first.");

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.merchantId, merchant.id), eq(products.active, true)))
    .limit(1);
  if (!product) throw new Error("Demo catalog is empty — run npm run db:seed first.");

  const shipmentStatus = kind === "stuck_parcel" ? "on_hold" : "delivered";
  const tracking = `DEMO${Date.now().toString(36).toUpperCase()}`;

  const created = await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ seq: string }>(sql`SELECT nextval('order_number_seq') AS seq`);
    const seq = rows[0]?.seq;
    if (!seq) throw new Error("Could not allocate an order number.");
    const orderNumber = `FR-${seq}`;
    const placedAt = new Date(Date.now() - 5 * 864e5);

    const [order] = await tx
      .insert(orders)
      .values({
        merchantId: merchant.id,
        buyerId: buyer.id,
        orderNumber,
        source: "demo_store",
        status: "captured",
        amountCents: product.priceCents,
        softDescriptor: merchant.softDescriptor ?? "TRAILHEAD FRPLY.CO/HLP",
        createdAt: placedAt,
        capturedAt: placedAt,
      })
      .returning();

    await tx.insert(orderItems).values({
      orderId: order.id,
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitPriceCents: product.priceCents,
    });

    await tx.insert(shipments).values({
      orderId: order.id,
      carrier: "UPS",
      trackingNumber: tracking,
      status: shipmentStatus,
      shippedAt: placedAt,
      deliveredAt: kind === "delivered_ok" ? new Date() : null,
      lastStatusAt: new Date(),
    });

    return order;
  });

  return {
    orderId: created.id,
    orderNumber: created.orderNumber,
    buyerEmail: buyer.email,
    buyerName: buyer.name,
    amountCents: created.amountCents,
    shipmentStatus,
    helpPath: `/s/${DEMO_SLUG}`,
  };
}
