import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

function noActionForeignKeys(): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    for (const fk of config.foreignKeys) {
      const onDelete = fk.onDelete ?? "no action";
      if (onDelete === "cascade" || onDelete === "set null") continue;
      for (const col of fk.reference().columns) {
        out.push({ table: config.name, column: col.name });
      }
    }
  }
  return out.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

describe("resetDemoStore FK blockers", () => {
  it("clears every ON DELETE NO ACTION FK before deleting the merchant", () => {
    const source = readFileSync(fileURLToPath(new URL("./seed-store.ts", import.meta.url)), "utf8");
    const blockers = noActionForeignKeys();
    expect(blockers.length).toBeGreaterThan(0);
    for (const { table, column } of blockers) {
      expect(source, `resetDemoStore must clear ${table}.${column} before DELETE merchants`).toContain(column);
    }
  });
});

/** Destructive: wipes Trailhead. Opt in with `DEMO_RESET_IT=1` against a local DATABASE_URL. */
const runDb = process.env.DEMO_RESET_IT === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!runDb)("resetDemoStore against leftover Day 8–11 rows", () => {
  afterAll(async () => {
    const { pool } = await import("@/db");
    await pool.end();
  });

  it("wipes leftover graph and restores seeded buyers and trust tiers", async () => {
    process.env.DEMO_OWNER_PASSWORD ??= "test-owner-password";
    const { and, eq, sql } = await import("drizzle-orm");
    const { db } = await import("@/db");
    const {
      actions,
      approvals,
      buyers,
      caseFacts,
      cases,
      chatSessions,
      disputeDrafts,
      disputes,
      disputeSubmissions,
      merchants,
      merchantUsers,
      messages,
      offers,
      orderItems,
      orders,
      products,
      refunds,
      shipments,
    } = await import("@/db/schema");
    const { sha256 } = await import("@/lib/crypto");
    const { DEMO_SLUG, resetDemoStore } = await import("./seed-store");

    const first = await resetDemoStore();
    expect(first).toMatchObject({ merchants: 1, products: 6, buyers: 3, orders: 10, cases: 2 });

    const [merchant] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_SLUG));
    const [owner] = await db.select().from(merchantUsers).where(eq(merchantUsers.merchantId, merchant.id));
    const [maya] = await db.select().from(buyers).where(eq(buyers.email, "maya.chen@example.com"));
    const [product] = await db.select().from(products).where(eq(products.merchantId, merchant.id)).limit(1);
    const [order] = await db.select().from(orders).where(eq(orders.buyerId, maya.id)).limit(1);

    const [john] = await db
      .insert(buyers)
      .values({ merchantId: merchant.id, name: "John Doe", email: "john.doe@example.com" })
      .returning();
    const [johnOrder] = await db
      .insert(orders)
      .values({
        merchantId: merchant.id,
        buyerId: john.id,
        orderNumber: "FR-JOHN-1",
        source: "demo_store",
        status: "captured",
        amountCents: product.priceCents,
        capturedAt: new Date(),
      })
      .returning();
    await db.insert(orderItems).values({
      orderId: johnOrder.id,
      productId: product.id,
      name: product.name,
      quantity: 1,
      unitPriceCents: product.priceCents,
    });

    const [openCase] = await db
      .insert(cases)
      .values({
        merchantId: merchant.id,
        orderId: order.id,
        buyerId: maya.id,
        issueType: "not_received",
        status: "open",
        trustTierAtOpen: "trusted",
        summary: "leftover day-8 case",
      })
      .returning();
    const [action] = await db
      .insert(actions)
      .values({
        caseId: openCase.id,
        merchantId: merchant.id,
        actor: "agent",
        tool: "get_shipment_status",
        arguments: {},
        result: { status: "DELIVERED" },
        status: "ok",
      })
      .returning();
    await db.insert(caseFacts).values({
      caseId: openCase.id,
      factType: "tracking_status",
      value: { status: "DELIVERED" },
      sourceActionId: action.id,
    });
    const [offer] = await db
      .insert(offers)
      .values({
        caseId: openCase.id,
        type: "full_refund",
        amountCents: 100,
        policyDecision: "needs_approval",
        status: "executed",
        executedActionId: action.id,
      })
      .returning();
    await db.insert(approvals).values({
      offerId: offer.id,
      caseId: openCase.id,
      requestedReason: "over auto-refund limit",
      status: "approved",
      decidedBy: owner.id,
      dueAt: new Date(),
      decidedAt: new Date(),
    });
    await db.insert(refunds).values({
      orderId: order.id,
      offerId: offer.id,
      idempotencyKey: `leftover-${order.id}`,
      amountCents: 100,
      status: "completed",
    });
    await db.insert(messages).values({
      caseId: openCase.id,
      seq: 1,
      role: "buyer",
      messageJson: { role: "user", content: "where's my pack" },
      textPreview: "where's my pack",
    });
    await db.insert(chatSessions).values({
      merchantId: merchant.id,
      orderId: order.id,
      caseId: openCase.id,
      door: "hosted_page",
      tokenHash: sha256(`leftover-chat-${Date.now()}`),
      verifiedBy: "order_number_email",
      expiresAt: new Date(Date.now() + 864e5),
    });

    const [originalShip] = await db
      .insert(shipments)
      .values({ orderId: order.id, carrier: "UPS", trackingNumber: "1ZLEFTOVER1", status: "lost" })
      .returning();
    await db.insert(shipments).values({
      orderId: order.id,
      carrier: "UPS",
      trackingNumber: "1ZLEFTOVER2",
      status: "shipped",
      isReship: true,
      replacesShipmentId: originalShip.id,
    });

    const [dispute] = await db
      .insert(disputes)
      .values({
        merchantId: merchant.id,
        paypalDisputeId: `PP-R-LEFTOVER-${Date.now()}`,
        orderId: order.id,
        caseId: openCase.id,
        buyerId: maya.id,
        reason: "merchandise_or_service_not_received",
        stage: "inquiry",
        status: "WAITING_FOR_SELLER_RESPONSE",
        amountCents: order.amountCents,
        createdAtPaypal: new Date(),
      })
      .returning();
    const [draft] = await db
      .insert(disputeDrafts)
      .values({
        disputeId: dispute.id,
        version: 1,
        recommendation: "fight",
        action: "provide_evidence",
        reasoning: "leftover",
        responseText: "leftover",
        createdBy: "agent",
      })
      .returning();
    await db.insert(disputeSubmissions).values({
      disputeId: dispute.id,
      draftId: draft.id,
      action: "provide_evidence",
      request: { notes: "leftover" },
      ok: true,
      submittedBy: owner.id,
    });
    await db.insert(disputes).values({
      merchantId: merchant.id,
      paypalDisputeId: `PP-R-JOHN-${Date.now()}`,
      orderId: johnOrder.id,
      buyerId: john.id,
      reason: "merchandise_or_service_not_received",
      stage: "chargeback",
      status: "RESOLVED",
      amountCents: johnOrder.amountCents,
      outcome: "won_by_seller",
      createdAtPaypal: new Date(),
    });

    const afterLeftover = await resetDemoStore();
    expect(afterLeftover).toMatchObject({ merchants: 1, products: 6, buyers: 3, orders: 10, cases: 2 });

    const seeded = await db
      .select({ email: buyers.email, name: buyers.name, trustTier: buyers.trustTier })
      .from(buyers)
      .innerJoin(merchants, eq(merchants.id, buyers.merchantId))
      .where(eq(merchants.slug, DEMO_SLUG));
    expect(seeded.map((b) => b.email).sort()).toEqual(["jordan.blake@example.com", "maya.chen@example.com", "sam.rivera@example.com"]);
    expect(seeded.find((b) => b.email === "maya.chen@example.com")?.trustTier).toBe("trusted");
    expect(seeded.find((b) => b.email === "sam.rivera@example.com")?.trustTier).toBe("normal");
    expect(seeded.find((b) => b.email === "jordan.blake@example.com")?.trustTier).toBe("watch");
    expect(seeded.some((b) => b.email === "john.doe@example.com")).toBe(false);

    const [merchantAfter] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, DEMO_SLUG));
    const leftoverCounts = await db.execute<{
      disputes: number;
      chats: number;
      actions: number;
      john_orders: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM disputes WHERE merchant_id = ${merchantAfter.id}) AS disputes,
        (SELECT count(*)::int FROM chat_sessions WHERE merchant_id = ${merchantAfter.id}) AS chats,
        (SELECT count(*)::int FROM actions WHERE merchant_id = ${merchantAfter.id}) AS actions,
        (SELECT count(*)::int FROM orders o JOIN buyers b ON b.id = o.buyer_id
           WHERE o.merchant_id = ${merchantAfter.id} AND b.email = 'john.doe@example.com') AS john_orders
    `);
    const leftover = leftoverCounts.rows[0];
    expect(Number(leftover.disputes)).toBe(0);
    expect(Number(leftover.chats)).toBe(0);
    expect(Number(leftover.actions)).toBe(0);
    expect(Number(leftover.john_orders)).toBe(0);

    const again = await resetDemoStore();
    expect(again).toMatchObject({ merchants: 1, products: 6, buyers: 3, orders: 10, cases: 2 });
    const [merchantAgain] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, DEMO_SLUG));
    const [mayaAgain] = await db
      .select()
      .from(buyers)
      .where(and(eq(buyers.merchantId, merchantAgain.id), eq(buyers.email, "maya.chen@example.com")));
    expect(mayaAgain?.trustTier).toBe("trusted");
  }, 60_000);
});
