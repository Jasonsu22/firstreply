import { describe, expect, it } from "vitest";
import { computeTrustTier, effectiveTier, type TrustInputs } from "./trust";

const clean: TrustInputs = {
  ordersTotal: 1,
  ordersLast12m: 1,
  claimsLast90d: 0,
  claimsLast12m: 0,
  notReceivedButDeliveredLast12m: 0,
  disputesLostByBuyer: 0,
  declinedOfferThenDisputed: 0,
  refundedLast12mCents: 0,
};
const buyer = (overrides: Partial<TrustInputs>) => ({ ...clean, ...overrides });

describe("computeTrustTier", () => {
  it("treats a first-time buyer as normal", () => {
    expect(computeTrustTier(clean)).toEqual({ tier: "normal", reasons: ["first order"] });
  });

  it("trusts a long history with no claims", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 6, ordersLast12m: 4 }));
    expect(result.tier).toBe("trusted");
    expect(result.reasons).toEqual(["6 orders, no claims in 12 months"]);
  });

  it("doesn't trust a long history that has a recent claim", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 8, ordersLast12m: 8, claimsLast12m: 1 }));
    expect(result.tier).toBe("normal");
  });

  it("lets old claims (over 12 months) fall away so buyers can recover", () => {
    // 3 claims long ago don't show up in the 12-month counts at all.
    const result = computeTrustTier(buyer({ ordersTotal: 9, ordersLast12m: 5 }));
    expect(result.tier).toBe("trusted");
  });

  it("does not put a new customer on watch for one lost parcel (100% claim rate on 1 order)", () => {
    const result = computeTrustTier(buyer({ claimsLast90d: 1, claimsLast12m: 1 }));
    expect(result.tier).toBe("normal");
  });

  it("watches 2 claims in 90 days", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 10, ordersLast12m: 10, claimsLast90d: 2, claimsLast12m: 2 }));
    expect(result.tier).toBe("watch");
    expect(result.reasons).toContain("2 claims in the last 90 days");
  });

  it("watches a claim rate above 20% once there are 2+ claims", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 6, ordersLast12m: 6, claimsLast90d: 0, claimsLast12m: 2 }));
    expect(result.tier).toBe("watch");
    expect(result.reasons).toEqual(["claim rate 33% (2 of 6 orders in 12 months)"]);
  });

  it("does not watch a claim rate of exactly 20%", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 10, ordersLast12m: 10, claimsLast12m: 2 }));
    expect(result.tier).toBe("normal");
  });

  it("watches a single 'not received' claim on a delivered parcel", () => {
    const result = computeTrustTier(buyer({ claimsLast12m: 1, notReceivedButDeliveredLast12m: 1 }));
    expect(result.tier).toBe("watch");
  });

  it("watches buyers who declined a fair offer and then disputed", () => {
    expect(computeTrustTier(buyer({ declinedOfferThenDisputed: 1 })).tier).toBe("watch");
  });

  it("watches high refund totals", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 12, ordersLast12m: 12, refundedLast12mCents: 30000 }));
    expect(result.tier).toBe("watch");
    expect(result.reasons).toEqual(["$300.00 refunded in the last 12 months"]);
  });

  it("marks high risk after losing a dispute, even with a long clean history", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 20, ordersLast12m: 10, disputesLostByBuyer: 1 }));
    expect(result.tier).toBe("high_risk");
    expect(result.reasons).toEqual(["lost 1 past dispute where the store showed evidence"]);
  });

  it("marks high risk for repeated 'not received' claims on delivered parcels", () => {
    const result = computeTrustTier(buyer({ ordersTotal: 4, ordersLast12m: 4, claimsLast12m: 2, notReceivedButDeliveredLast12m: 2 }));
    expect(result.tier).toBe("high_risk");
  });

  it("lists every reason that applies, not just the first", () => {
    const result = computeTrustTier(
      buyer({ ordersTotal: 3, ordersLast12m: 3, claimsLast90d: 2, claimsLast12m: 2, declinedOfferThenDisputed: 1 }),
    );
    expect(result.reasons).toHaveLength(3);
  });

  it("respects merchant-adjusted thresholds", () => {
    const strict = { watchClaims90d: 1, watchClaimRatePct: 20, highRiskDeliveredClaims: 2, trustedMinOrders: 5, watchRefundedLast12mCents: 30000 };
    expect(computeTrustTier(buyer({ claimsLast90d: 1, claimsLast12m: 1 }), strict).tier).toBe("watch");
  });
});

describe("effectiveTier", () => {
  it("uses the computed tier by default", () => {
    expect(effectiveTier({ trustTier: "watch", manualTier: null })).toBe("watch");
  });

  it("lets a merchant override win", () => {
    expect(effectiveTier({ trustTier: "watch", manualTier: "trusted" })).toBe("trusted");
  });
});
