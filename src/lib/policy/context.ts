/**
 * Database side of the policy and trust engines: gathers the facts they need.
 * The engines themselves (./engine.ts, ./trust.ts) stay pure and unit-tested.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buyers, orders, policies, refunds, shipments } from "@/db/schema";
import type { IssueType, PolicyContext } from "./engine";
import { computeTrustTier, DEFAULT_TRUST_THRESHOLDS, effectiveTier, type TrustInputs, type TrustResult } from "./trust";

/** Counts behind a buyer's trust tier (docs/DATABASE.md §4). Only this merchant's data — buyers are scoped per store. */
export async function loadTrustInputs(buyerId: string, now = new Date()): Promise<TrustInputs> {
  const { rows } = await db.execute<Record<keyof TrustInputs, string>>(sql`
    WITH b AS (SELECT ${buyerId}::uuid AS id, ${now.toISOString()}::timestamptz AS now)
    SELECT
      (SELECT count(*) FROM orders o, b WHERE o.buyer_id = b.id AND o.status <> 'created') AS "ordersTotal",
      (SELECT count(*) FROM orders o, b WHERE o.buyer_id = b.id AND o.status <> 'created'
          AND coalesce(o.captured_at, o.created_at) > b.now - interval '12 months') AS "ordersLast12m",
      (SELECT count(*) FROM cases c, b WHERE c.buyer_id = b.id AND c.opened_at > b.now - interval '90 days') AS "claimsLast90d",
      (SELECT count(*) FROM cases c, b WHERE c.buyer_id = b.id AND c.opened_at > b.now - interval '12 months') AS "claimsLast12m",
      (SELECT count(*) FROM cases c, b WHERE c.buyer_id = b.id AND c.issue_type = 'not_received'
          AND c.opened_at > b.now - interval '12 months'
          AND EXISTS (SELECT 1 FROM case_facts f WHERE f.case_id = c.id AND f.fact_type = 'delivery_confirmed')) AS "notReceivedButDeliveredLast12m",
      (SELECT count(*) FROM disputes d, b WHERE d.buyer_id = b.id AND d.outcome = 'won_by_seller') AS "disputesLostByBuyer",
      (SELECT count(*) FROM cases c, b WHERE c.buyer_id = b.id
          AND EXISTS (SELECT 1 FROM offers f WHERE f.case_id = c.id AND f.status = 'declined')
          AND (c.status = 'disputed' OR EXISTS (SELECT 1 FROM disputes d WHERE d.case_id = c.id))) AS "declinedOfferThenDisputed",
      (SELECT coalesce(sum(r.amount_cents), 0) FROM refunds r JOIN orders o ON o.id = r.order_id, b
          WHERE o.buyer_id = b.id AND r.status = 'completed' AND r.created_at > b.now - interval '12 months') AS "refundedLast12mCents"
  `);
  const row = rows[0];
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as TrustInputs;
}

/** Recomputes and stores a buyer's tier. Run when a case opens and when one closes. */
export async function recomputeBuyerTier(buyerId: string, now = new Date()): Promise<TrustResult> {
  const [buyer] = await db.select().from(buyers).where(eq(buyers.id, buyerId));
  if (!buyer) throw new Error(`Buyer ${buyerId} not found`);
  const [policy] = await db.select().from(policies).where(eq(policies.merchantId, buyer.merchantId));

  const result = computeTrustTier(await loadTrustInputs(buyerId, now), {
    ...DEFAULT_TRUST_THRESHOLDS,
    ...(policy && {
      watchClaims90d: policy.watchClaims90d,
      watchClaimRatePct: policy.watchClaimRatePct,
      highRiskDeliveredClaims: policy.highRiskDeliveredClaims,
    }),
  });
  await db.update(buyers).set({ trustTier: result.tier, tierReasons: result.reasons, tierComputedAt: now }).where(eq(buyers.id, buyerId));
  return result;
}

/** Everything the policy engine needs to judge a fix for one order. */
export async function loadPolicyContext(orderId: string, issueType: IssueType, now = new Date()): Promise<PolicyContext> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`Order ${orderId} not found`);
  const [[policy], [buyer], orderShipments, [completedRefund]] = await Promise.all([
    db.select().from(policies).where(eq(policies.merchantId, order.merchantId)),
    order.buyerId ? db.select().from(buyers).where(eq(buyers.id, order.buyerId)) : Promise.resolve([]),
    db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.shippedAt)),
    db
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(eq(refunds.orderId, orderId), eq(refunds.status, "completed")))
      .limit(1),
  ]);
  if (!policy) throw new Error(`Merchant ${order.merchantId} has no policy row`);

  const latest = orderShipments[0];
  const reshipCount = orderShipments.filter((s) => s.isReship).length;
  return {
    policy: {
      autoRefundLimitCents: policy.autoRefundLimitCents,
      trustedAutoRefundLimitCents: policy.trustedAutoRefundLimitCents,
      reshipAllowed: policy.reshipAllowed,
      maxReshipsPerOrder: policy.maxReshipsPerOrder,
      notReceivedWaitDays: policy.notReceivedWaitDays,
    },
    issueType,
    order: { status: order.status, amountCents: order.amountCents, refundedCents: order.refundedCents },
    shipment: latest ? { status: latest.status, shippedAt: latest.shippedAt } : null,
    reshipCount,
    priorResolution: completedRefund || order.refundedCents > 0 ? "refund" : reshipCount > 0 ? "reship" : null,
    // An order without a known buyer (shouldn't happen for paid orders) gets the cautious default.
    buyer: buyer ? { tier: effectiveTier(buyer), flagged: buyer.flagged } : { tier: "watch", flagged: false },
    now,
  };
}
