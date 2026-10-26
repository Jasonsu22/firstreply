/**
 * Resets and seeds the demo store. Safe to re-run: it deletes the demo merchant
 * (everything cascades) and recreates it.
 *
 *   npm run db:seed
 *
 * The console login is owner@trailhead.test. Its password comes from DEMO_OWNER_PASSWORD;
 * if that isn't set, one is generated and saved to .env.local (never printed).
 */
import "@/lib/load-env";
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { buyers, merchants, merchantUsers, orderItems, orders, policies, products } from "@/db/schema";
import { encryptSecret, sha256 } from "@/lib/crypto";

const SLUG = "trailhead";
const OWNER_EMAIL = "owner@trailhead.test";

const PRODUCTS = [
  { name: "Summit 40L Backpack", description: "Weatherproof hiking pack with a ventilated back panel.", priceCents: 12900 },
  { name: "Trail Runner Shoes", description: "Lightweight trail shoes with a rock plate and grippy outsole.", priceCents: 11900 },
  { name: "Insulated Water Bottle", description: "Keeps drinks cold for 24 hours, hot for 12. 750 ml.", priceCents: 3200 },
  { name: "Merino Wool Beanie", description: "Soft, warm and itch-free. One size.", priceCents: 2800 },
  { name: "Headlamp 400", description: "400-lumen rechargeable headlamp with red night mode.", priceCents: 4500 },
  { name: "Packable Rain Jacket", description: "2.5-layer waterproof shell that packs into its own pocket.", priceCents: 8900 },
] as const;

// Seeded history so the trust tiers show up in the demo (see docs/DATABASE.md §7).
const BUYERS = [
  {
    name: "Maya Chen",
    email: "maya.chen@example.com",
    address: "12 Pine St, Portland, OR 97201, US",
    tier: "trusted",
    reasons: ["6 orders over 14 months", "no claims"],
    pastOrders: 6,
  },
  {
    name: "Sam Rivera",
    email: "sam.rivera@example.com",
    address: "88 Oak Ave, Austin, TX 78701, US",
    tier: "normal",
    reasons: ["first order"],
    pastOrders: 1,
  },
  {
    name: "Jordan Blake",
    email: "jordan.blake@example.com",
    address: "5 Elm Ct, Denver, CO 80202, US",
    tier: "watch",
    reasons: ["2 'not received' claims in the last 90 days", "claim rate 67% (2 of 3 orders)"],
    pastOrders: 3,
  },
] as const;

function normalizeAddress(address: string) {
  return address.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function ownerPasswordHash() {
  let password = process.env.DEMO_OWNER_PASSWORD;
  if (!password) {
    password = randomBytes(12).toString("base64url");
    appendFileSync(".env.local", `\n# Merchant console login for ${OWNER_EMAIL} (created by db:seed)\nDEMO_OWNER_PASSWORD=${password}\n`);
    console.log(`Generated a console password for ${OWNER_EMAIL} and saved it to .env.local (DEMO_OWNER_PASSWORD).`);
  }
  return hash(password);
}

async function main() {
  const passwordHash = await ownerPasswordHash();

  await db.transaction(async (tx) => {
    await tx.delete(merchants).where(eq(merchants.slug, SLUG));

    const [merchant] = await tx
      .insert(merchants)
      .values({
        name: "Trailhead Supply Co.",
        slug: SLUG,
        paypalEnv: "sandbox",
        paypalClientId: process.env.PAYPAL_CLIENT_ID ?? null,
        paypalClientSecretEnc: process.env.PAYPAL_CLIENT_SECRET ? encryptSecret(process.env.PAYPAL_CLIENT_SECRET) : null,
        softDescriptor: "TRAILHEAD FRPLY.CO/HLP",
        storeNotes: [
          "Ships from Portland, OR within 1 business day.",
          "US delivery usually takes 3–5 business days by UPS Ground.",
          "Returns accepted within 30 days, unused, in original packaging.",
        ].join("\n"),
      })
      .returning();

    await tx.insert(merchantUsers).values({ merchantId: merchant.id, email: OWNER_EMAIL, passwordHash, role: "owner" });
    await tx.insert(policies).values({ merchantId: merchant.id });

    const seededProducts = await tx
      .insert(products)
      .values(PRODUCTS.map((p) => ({ ...p, merchantId: merchant.id })))
      .returning();

    let orderSeq = 10000;
    for (const b of BUYERS) {
      const [buyer] = await tx
        .insert(buyers)
        .values({
          merchantId: merchant.id,
          name: b.name,
          email: b.email,
          addressHash: sha256(normalizeAddress(b.address)),
          trustTier: b.tier,
          tierReasons: [...b.reasons],
          tierComputedAt: new Date(),
        })
        .returning();

      // Past orders (no PayPal IDs: they're seeded history, not sandbox transactions).
      for (let i = 0; i < b.pastOrders; i++) {
        const product = seededProducts[(orderSeq + i) % seededProducts.length];
        const placedAt = new Date(Date.now() - (b.pastOrders - i) * 45 * 864e5);
        const [order] = await tx
          .insert(orders)
          .values({
            merchantId: merchant.id,
            buyerId: buyer.id,
            orderNumber: `FR-${++orderSeq}`,
            source: "demo_store",
            status: "captured",
            amountCents: product.priceCents,
            softDescriptor: "TRAILHEAD FRPLY.CO/HLP",
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
      }
    }
  });

  const counts = await pool.query(`
    SELECT (SELECT count(*) FROM merchants) merchants, (SELECT count(*) FROM products) products,
           (SELECT count(*) FROM buyers) buyers, (SELECT count(*) FROM orders) orders`);
  console.log("Seeded:", counts.rows[0]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
