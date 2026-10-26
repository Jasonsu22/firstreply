/**
 * Checkout: our database is the source of truth for prices, PayPal for payment.
 * 1. startCheckout  — prices the cart from the DB, saves a `created` order, creates the PayPal order
 * 2. completeCheckout — captures in PayPal, records the buyer, address and capture id
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { buyers, orderItems, orders, products, type ShippingAddress } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { payPalToCents } from "@/lib/money";
import { capturePayPalOrder, createPayPalOrder, type PayPalOrder } from "@/lib/paypal/orders";
import { getDemoMerchant } from "@/lib/store";

export type CartLine = { productId: string; quantity: number };

export class CheckoutError extends Error {}

export async function startCheckout(cart: CartLine[]) {
  const merchant = await getDemoMerchant();
  const ids = [...new Set(cart.map((l) => l.productId))];
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.merchantId, merchant.id), eq(products.active, true), inArray(products.id, ids)));
  if (rows.length !== ids.length) throw new CheckoutError("Some items in your cart are no longer available.");

  const byId = new Map(rows.map((p) => [p.id, p]));
  const lines = ids.map((id) => {
    const product = byId.get(id)!;
    const quantity = cart.filter((l) => l.productId === id).reduce((n, l) => n + l.quantity, 0);
    return { product, quantity };
  });
  const amountCents = lines.reduce((sum, l) => sum + l.product.priceCents * l.quantity, 0);

  const order = await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ seq: string }>(sql`SELECT nextval('order_number_seq') AS seq`);
    const seq = rows[0].seq;
    const [created] = await tx
      .insert(orders)
      .values({
        merchantId: merchant.id,
        orderNumber: `FR-${seq}`,
        source: "demo_store",
        status: "created",
        amountCents,
        softDescriptor: merchant.softDescriptor,
      })
      .returning();
    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: created.id,
        productId: l.product.id,
        name: l.product.name,
        sku: l.product.id.slice(0, 8).toUpperCase(),
        quantity: l.quantity,
        unitPriceCents: l.product.priceCents,
        imageUrl: l.product.imageUrl,
      })),
    );
    return created;
  });

  const paypalOrder = await createPayPalOrder({
    orderNumber: order.orderNumber,
    localOrderId: order.id,
    brandName: merchant.name,
    softDescriptor: merchant.softDescriptor,
    currency: order.currency,
    lines: lines.map((l) => ({
      name: l.product.name,
      sku: l.product.id.slice(0, 8).toUpperCase(),
      quantity: l.quantity,
      unitPriceCents: l.product.priceCents,
    })),
  });
  await db.update(orders).set({ paypalOrderId: paypalOrder.id, raw: paypalOrder }).where(eq(orders.id, order.id));
  return { paypalOrderId: paypalOrder.id, orderNumber: order.orderNumber };
}

function toShippingAddress(paypal: PayPalOrder): ShippingAddress | null {
  const shipping = paypal.purchase_units?.[0]?.shipping;
  if (!shipping?.address) return null;
  return { name: shipping.name?.full_name, ...shipping.address };
}

function addressHash(address: ShippingAddress | null): string | null {
  if (!address) return null;
  const parts = [address.address_line_1, address.address_line_2, address.admin_area_2, address.admin_area_1, address.postal_code, address.country_code];
  return sha256(parts.filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]/g, ""));
}

export async function completeCheckout(paypalOrderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.paypalOrderId, paypalOrderId));
  if (!order) throw new CheckoutError("We couldn't find this order.");
  if (order.status !== "created" && order.buyerId) return { orderNumber: order.orderNumber, buyerId: order.buyerId };

  const captured = await capturePayPalOrder(paypalOrderId);
  const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture) throw new CheckoutError(`PayPal didn't complete the payment (status ${captured.status}).`);
  if (payPalToCents(capture.amount.value) !== order.amountCents) {
    // Never happens unless someone tampers with the PayPal order — record it loudly rather than silently accept.
    throw new CheckoutError(`Captured amount ${capture.amount.value} doesn't match order ${order.orderNumber}.`);
  }

  const payer = captured.payer ?? {};
  const email = payer.email_address;
  if (!email) throw new CheckoutError("PayPal didn't share the buyer's email.");
  const shippingAddress = toShippingAddress(captured);
  const name = [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(" ") || shippingAddress?.name || null;

  return db.transaction(async (tx) => {
    const [buyer] = await tx
      .insert(buyers)
      .values({
        merchantId: order.merchantId,
        email,
        name,
        paypalPayerId: payer.payer_id ?? null,
        addressHash: addressHash(shippingAddress),
      })
      .onConflictDoUpdate({
        target: [buyers.merchantId, buyers.email],
        set: { paypalPayerId: payer.payer_id ?? null, ...(name && { name }) },
      })
      .returning();

    await tx
      .update(orders)
      .set({
        buyerId: buyer.id,
        status: "captured",
        paypalCaptureId: capture.id,
        shippingAddress,
        raw: captured,
        capturedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    return { orderNumber: order.orderNumber, buyerId: buyer.id };
  });
}
