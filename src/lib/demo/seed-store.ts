/**
 * Resets and seeds the demo store (Trailhead Supply Co.).
 * Used by `npm run db:seed` / `db:reset` and by the demo panel's one-click reset.
 */
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buyers, cases, merchants, merchantUsers, orderItems, orders, policies, products, refunds } from "@/db/schema";
import { encryptSecret, sha256 } from "@/lib/crypto";
import { recomputeBuyerTier } from "@/lib/policy/context";

export const DEMO_SLUG = "trailhead";
export const DEMO_OWNER_EMAIL = "owner@trailhead.test";

const PRODUCTS = [
  { name: "Summit 40L Backpack", description: "Weatherproof hiking pack with a ventilated back panel.", priceCents: 12900 },
  { name: "Trail Runner Shoes", description: "Lightweight trail shoes with a rock plate and grippy outsole.", priceCents: 11900 },
  { name: "Insulated Water Bottle", description: "Keeps drinks cold for 24 hours, hot for 12. 750 ml.", priceCents: 3200 },
  { name: "Merino Wool Beanie", description: "Soft, warm and itch-free. One size.", priceCents: 2800 },
  { name: "Headlamp 400", description: "400-lumen rechargeable headlamp with red night mode.", priceCents: 4500 },
  { name: "Packable Rain Jacket", description: "2.5-layer waterproof shell that packs into its own pocket.", priceCents: 8900 },
] as const;

const BUYERS = [
  {
    name: "Maya Chen",
    email: "maya.chen@example.com",
    address: "12 Pine St, Portland, OR 97201, US",
    pastOrders: 6,
    claimsOnLatestOrders: 0,
  },
  {
    name: "Sam Rivera",
    email: "sam.rivera@example.com",
    address: "88 Oak Ave, Austin, TX 78701, US",
    pastOrders: 1,
    claimsOnLatestOrders: 0,
  },
  {
    name: "Jordan Blake",
    email: "jordan.blake@example.com",
    address: "5 Elm Ct, Denver, CO 80202, US",
    pastOrders: 3,
    claimsOnLatestOrders: 2,
  },
] as const;

function normalizeAddress(address: string) {
  return address.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function ownerPasswordHash() {
  let password = process.env.DEMO_OWNER_PASSWORD;
  if (!password && process.env.RENDER) {
    throw new Error("Set DEMO_OWNER_PASSWORD in the Render dashboard before seeding");
  }
  if (!password) {
    password = randomBytes(12).toString("base64url");
    appendFileSync(".env.local", `\n# Merchant console login for ${DEMO_OWNER_EMAIL} (created by db:seed)\nDEMO_OWNER_PASSWORD=${password}\n`);
    console.log(`Generated a console password for ${DEMO_OWNER_EMAIL} and saved it to .env.local (DEMO_OWNER_PASSWORD).`);
  }
  return hash(password);
}

export type SeedSummary = {
  merchants: number;
  products: number;
  buyers: number;
  orders: number;
  cases: number;
};

/** Wipe the Trailhead merchant (cascades) and recreate products, buyers, history. */
export async function resetDemoStore(opts: { ifEmpty?: boolean } = {}): Promise<SeedSummary | { skipped: true }> {
  if (opts.ifEmpty) {
    const [existing] = await db.select({ id: merchants.id }).from(merchants).limit(1);
    if (existing) {
      console.log("Database already has data — skipping seed.");
      return { skipped: true };
    }
  }

  const passwordHash = await ownerPasswordHash();

  await db.transaction(async (tx) => {
    // The audit log is append-only; a demo reset is the one place allowed to delete it (see drizzle/0004).
    await tx.execute(sql`SELECT set_config('firstreply.allow_audit_delete', 'on', true)`);

    // approvals.decided_by and dispute_submissions.submitted_by reference merchant_users
    // with ON DELETE NO ACTION. Postgres may cascade-delete merchant_users (via merchants)
    // before approvals (via cases) are gone, which fails the seed when leftover Day-8+
    // rows still point at those users. Clear the blockers first.
    await tx.execute(sql`
      UPDATE approvals AS a
      SET decided_by = NULL
      FROM merchant_users AS mu
      INNER JOIN merchants AS m ON m.id = mu.merchant_id
      WHERE a.decided_by = mu.id AND m.slug = ${DEMO_SLUG}
    `);
    await tx.execute(sql`
      UPDATE dispute_submissions AS ds
      SET submitted_by = NULL
      FROM merchant_users AS mu
      INNER JOIN merchants AS m ON m.id = mu.merchant_id
      WHERE ds.submitted_by = mu.id AND m.slug = ${DEMO_SLUG}
    `);

    await tx.delete(merchants).where(eq(merchants.slug, DEMO_SLUG));

    const [merchant] = await tx
      .insert(merchants)
      .values({
        name: "Trailhead Supply Co.",
        slug: DEMO_SLUG,
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

    await tx.insert(merchantUsers).values({ merchantId: merchant.id, email: DEMO_OWNER_EMAIL, passwordHash, role: "owner" });
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
        })
        .returning();

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

        if (i >= b.pastOrders - b.claimsOnLatestOrders) {
          const resolvedAt = new Date(placedAt.getTime() + 9 * 864e5);
          await tx.insert(cases).values({
            merchantId: merchant.id,
            orderId: order.id,
            buyerId: buyer.id,
            issueType: "not_received",
            status: "resolved",
            resolutionType: "full_refund",
            resolutionAmountCents: product.priceCents,
            trustTierAtOpen: "normal",
            summary: "Seeded history: parcel reported missing, refunded in full.",
            openedAt: new Date(placedAt.getTime() + 5 * 864e5),
            resolvedAt,
          });
          await tx.insert(refunds).values({
            orderId: order.id,
            idempotencyKey: `seed-${order.id}`,
            amountCents: product.priceCents,
            status: "completed",
            createdAt: resolvedAt,
          });
          await tx.update(orders).set({ status: "refunded", refundedCents: product.priceCents }).where(eq(orders.id, order.id));
        }
      }
    }
  });

  const seededBuyers = await db
    .select({ id: buyers.id, name: buyers.name })
    .from(buyers)
    .innerJoin(merchants, eq(merchants.id, buyers.merchantId))
    .where(eq(merchants.slug, DEMO_SLUG));
  for (const b of seededBuyers) {
    const { tier, reasons } = await recomputeBuyerTier(b.id);
    console.log(`  ${b.name}: ${tier} — ${reasons.join("; ")}`);
  }

  const merchantRow = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, DEMO_SLUG)).limit(1);
  const merchantId = merchantRow[0]?.id;
  const count = async (table: typeof products | typeof buyers | typeof orders | typeof cases) => {
    if (!merchantId) return 0;
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.merchantId, merchantId));
    return r?.n ?? 0;
  };
  const summary: SeedSummary = {
    merchants: merchantId ? 1 : 0,
    products: await count(products),
    buyers: await count(buyers),
    orders: await count(orders),
    cases: await count(cases),
  };

  console.log("Seeded:", summary);
  return summary;
}

/** True when the demo panel / API may wipe and re-seed (local + sandbox judges). */
export function demoResetAllowed() {
  if (process.env.DEMO_RESET_ENABLED === "true") return true;
  if (process.env.DEMO_CONSOLE_OPEN === "true") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}
