/**
 * Buyer trust tiers (PLAN.md §7.8): plain rules on counted facts, never set by the AI.
 * The tier doesn't ban anyone — it only decides how much the agent may do without the merchant.
 *
 * Pure function: the database adapter (./context.ts) gathers the counts.
 */
import { formatCents } from "@/lib/money";

export type TrustTier = "trusted" | "normal" | "watch" | "high_risk";

export type TrustInputs = {
  /** All of this buyer's paid orders with the merchant. */
  ordersTotal: number;
  ordersLast12m: number;
  claimsLast90d: number;
  /** Claims older than 12 months are ignored, so buyers can recover. */
  claimsLast12m: number;
  /** "Not received" claims where tracking showed the parcel delivered. */
  notReceivedButDeliveredLast12m: number;
  /** Disputes the merchant won with evidence. */
  disputesLostByBuyer: number;
  /** Declined a fair offer from the agent, then opened a PayPal dispute anyway. */
  declinedOfferThenDisputed: number;
  refundedLast12mCents: number;
};

export type TrustThresholds = {
  watchClaims90d: number;
  watchClaimRatePct: number;
  highRiskDeliveredClaims: number;
  /** Orders needed (with no claims) to count as trusted. */
  trustedMinOrders: number;
  /** Total refunded in 12 months that puts a buyer on watch. */
  watchRefundedLast12mCents: number;
};

export const DEFAULT_TRUST_THRESHOLDS: TrustThresholds = {
  watchClaims90d: 2,
  watchClaimRatePct: 20,
  highRiskDeliveredClaims: 2,
  trustedMinOrders: 5,
  watchRefundedLast12mCents: 30000,
};

/**
 * A claim rate only counts once there are at least this many claims, so one genuinely lost
 * parcel on a first order doesn't put a new customer on watch.
 */
const MIN_CLAIMS_FOR_RATE_RULE = 2;

export type TrustResult = { tier: TrustTier; reasons: string[] };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function computeTrustTier(inputs: TrustInputs, thresholds: TrustThresholds = DEFAULT_TRUST_THRESHOLDS): TrustResult {
  const highRisk: string[] = [];
  if (inputs.disputesLostByBuyer > 0) {
    highRisk.push(`lost ${plural(inputs.disputesLostByBuyer, "past dispute")} where the store showed evidence`);
  }
  if (inputs.notReceivedButDeliveredLast12m >= thresholds.highRiskDeliveredClaims) {
    highRisk.push(`${plural(inputs.notReceivedButDeliveredLast12m, "'not received' claim")} on parcels tracking showed delivered`);
  }
  if (highRisk.length) return { tier: "high_risk", reasons: highRisk };

  const watch: string[] = [];
  if (inputs.claimsLast90d >= thresholds.watchClaims90d) {
    watch.push(`${plural(inputs.claimsLast90d, "claim")} in the last 90 days`);
  }
  if (inputs.claimsLast12m >= MIN_CLAIMS_FOR_RATE_RULE && inputs.ordersLast12m > 0) {
    const ratePct = Math.round((inputs.claimsLast12m / inputs.ordersLast12m) * 100);
    if (ratePct > thresholds.watchClaimRatePct) {
      watch.push(`claim rate ${ratePct}% (${inputs.claimsLast12m} of ${plural(inputs.ordersLast12m, "order")} in 12 months)`);
    }
  }
  if (inputs.notReceivedButDeliveredLast12m > 0) {
    watch.push(`${plural(inputs.notReceivedButDeliveredLast12m, "'not received' claim")} on a parcel tracking showed delivered`);
  }
  if (inputs.declinedOfferThenDisputed > 0) {
    watch.push(`declined a fair offer, then disputed (${plural(inputs.declinedOfferThenDisputed, "time")})`);
  }
  if (inputs.refundedLast12mCents >= thresholds.watchRefundedLast12mCents) {
    watch.push(`${formatCents(inputs.refundedLast12mCents)} refunded in the last 12 months`);
  }
  if (watch.length) return { tier: "watch", reasons: watch };

  if (inputs.ordersTotal >= thresholds.trustedMinOrders && inputs.claimsLast12m === 0) {
    return { tier: "trusted", reasons: [`${plural(inputs.ordersTotal, "order")}, no claims in 12 months`] };
  }

  if (inputs.ordersTotal <= 1) return { tier: "normal", reasons: [inputs.ordersTotal === 0 ? "new customer" : "first order"] };
  return {
    tier: "normal",
    reasons: [`${plural(inputs.ordersTotal, "order")}, ${plural(inputs.claimsLast12m, "claim")} in 12 months`],
  };
}

/** The tier that actually applies: a merchant override always wins over the computed tier. */
export function effectiveTier(buyer: { trustTier: TrustTier; manualTier: TrustTier | null }): TrustTier {
  return buyer.manualTier ?? buyer.trustTier;
}
