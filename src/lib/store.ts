/** Read helpers for the demo storefront. The store is the seeded "trailhead" merchant. */
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { merchants, orderItems, orders, products, shipments } from "@/db/schema";

export const DEMO_STORE_SLUG = "trailhead";

export async function getDemoMerchant() {
  const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_STORE_SLUG));
  if (!merchant) throw new Error("Demo store not found — run `npm run db:seed`");
  return merchant;
}

export async function listProducts(merchantId: string) {
  return db
    .select()
    .from(products)
    .where(and(eq(products.merchantId, merchantId), eq(products.active, true)))
    .orderBy(asc(products.createdAt), asc(products.name));
}

export async function getProduct(merchantId: string, productId: string) {
  // Ignore malformed ids instead of letting Postgres reject them.
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return undefined;
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.merchantId, merchantId), eq(products.id, productId), eq(products.active, true)));
  return product;
}

export type Product = Awaited<ReturnType<typeof listProducts>>[number];

/** A buyer's paid orders, newest first, with items and shipments. Unpaid (abandoned) checkouts are hidden. */
export async function listBuyerOrders(buyerId: string, orderNumber?: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.buyerId, buyerId), ne(orders.status, "created"), orderNumber ? eq(orders.orderNumber, orderNumber) : undefined))
    .orderBy(desc(orders.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((o) => o.id);
  const [items, ships] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
    db.select().from(shipments).where(inArray(shipments.orderId, ids)).orderBy(desc(shipments.shippedAt)),
  ]);
  return rows.map((o) => ({
    ...o,
    items: items.filter((i) => i.orderId === o.id),
    shipments: ships.filter((s) => s.orderId === o.id),
  }));
}

export type BuyerOrder = Awaited<ReturnType<typeof listBuyerOrders>>[number];
