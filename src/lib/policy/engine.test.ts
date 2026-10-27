import { describe, expect, it } from "vitest";
import { evaluateProposal, type PolicyContext, type Proposal } from "./engine";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** A $45 order, shipped 10 days ago and stuck in transit, normal buyer, default store policy. */
function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    policy: {
      autoRefundLimitCents: 5000,
      trustedAutoRefundLimitCents: 10000,
      reshipAllowed: true,
      maxReshipsPerOrder: 1,
      notReceivedWaitDays: 7,
    },
    issueType: "not_received",
    order: { status: "captured", amountCents: 4500, refundedCents: 0 },
    shipment: { status: "on_hold", shippedAt: daysAgo(10) },
    reshipCount: 0,
    priorResolution: null,
    buyer: { tier: "normal", flagged: false },
    now: NOW,
    ...overrides,
  };
}

const refund: Proposal = { type: "full_refund" };
const codes = (ctx: PolicyContext, p: Proposal = refund) => evaluateProposal(p, ctx).reasons.map((r) => r.code);

describe("allowed fixes", () => {
  it("auto-refunds a stuck parcel within the limit", () => {
    const result = evaluateProposal(refund, context());
    expect(result).toMatchObject({ decision: "allowed", amountCents: 4500 });
    expect(result.reasons[0].code).toBe("WITHIN_POLICY");
  });

  it("auto-reships a stuck parcel", () => {
    expect(evaluateProposal({ type: "reship" }, context()).decision).toBe("allowed");
  });

  it("allows an explanation in every situation, with no money involved", () => {
    const result = evaluateProposal({ type: "explain" }, context({ buyer: { tier: "high_risk", flagged: true } }));
    expect(result).toMatchObject({ decision: "allowed", amountCents: null });
  });

  it("treats a lost parcel as not received straight away", () => {
    const result = evaluateProposal(refund, context({ shipment: { status: "lost", shippedAt: daysAgo(1) } }));
    expect(result.decision).toBe("allowed");
  });

  it("allows refunding an order that never shipped", () => {
    expect(evaluateProposal(refund, context({ shipment: null })).decision).toBe("allowed");
  });

  it("allows a valid partial refund for a damaged item", () => {
    const result = evaluateProposal({ type: "partial_refund", amountCents: 1000 }, context({ issueType: "damaged" }));
    expect(result).toMatchObject({ decision: "allowed", amountCents: 1000 });
  });

  it("only refunds what's left after an earlier partial refund", () => {
    const ctx = context({ order: { status: "partially_refunded", amountCents: 4500, refundedCents: 1000 } });
    expect(evaluateProposal(refund, ctx).amountCents).toBe(3500);
  });
});

describe("limits", () => {
  const pricey = context({ order: { status: "captured", amountCents: 12900, refundedCents: 0 } });

  it("sends refunds over the automatic limit to the merchant", () => {
    const result = evaluateProposal(refund, pricey);
    expect(result.decision).toBe("needs_approval");
    expect(result.reasons[0]).toMatchObject({ code: "OVER_AUTO_LIMIT", message: "$129.00 is over the automatic limit of $50.00." });
  });

  it("allows exactly the limit", () => {
    const atLimit = context({ order: { status: "captured", amountCents: 5000, refundedCents: 0 } });
    expect(evaluateProposal(refund, atLimit).decision).toBe("allowed");
  });

  it("gives trusted buyers the higher limit", () => {
    const trusted = context({ order: { status: "captured", amountCents: 9000, refundedCents: 0 }, buyer: { tier: "trusted", flagged: false } });
    expect(evaluateProposal(refund, trusted).decision).toBe("allowed");
  });

  it("counts a reship against the limit at the order's value", () => {
    expect(evaluateProposal({ type: "reship" }, pricey).decision).toBe("needs_approval");
  });
});

describe("buyer trust", () => {
  it.each(["watch", "high_risk"] as const)("never gives %s buyers automatic money", (tier) => {
    const result = evaluateProposal({ type: "partial_refund", amountCents: 500 }, context({ buyer: { tier, flagged: false } }));
    expect(result.decision).toBe("needs_approval");
    expect(result.reasons.map((r) => r.code)).toContain("TRUST_TIER");
  });

  it("never gives flagged buyers automatic money, even trusted ones", () => {
    const result = evaluateProposal(refund, context({ buyer: { tier: "trusted", flagged: true } }));
    expect(result.decision).toBe("needs_approval");
    expect(result.reasons[0].code).toBe("BUYER_FLAGGED");
  });
});

describe("not received: timing and tracking", () => {
  it("denies a money fix while the parcel is still in its delivery window", () => {
    const ctx = context({ shipment: { status: "shipped", shippedAt: daysAgo(3) } });
    const result = evaluateProposal(refund, ctx);
    expect(result.decision).toBe("denied");
    expect(result.reasons[0]).toMatchObject({ code: "TOO_EARLY" });
    expect(result.reasons[0].message).toContain("Nov 14");
  });

  it("counts a shipped parcel as not received once the window has passed", () => {
    expect(evaluateProposal(refund, context({ shipment: { status: "shipped", shippedAt: daysAgo(8) } })).decision).toBe("allowed");
  });

  it("asks the merchant when tracking says delivered", () => {
    const result = evaluateProposal(refund, context({ shipment: { status: "delivered", shippedAt: daysAgo(5) } }));
    expect(result.decision).toBe("needs_approval");
    expect(result.reasons[0].code).toBe("DELIVERED_PER_TRACKING");
  });
});

describe("one resolution per order", () => {
  it("denies a second fix after a refund", () => {
    expect(evaluateProposal(refund, context({ priorResolution: "refund" })).decision).toBe("denied");
  });

  it("denies refunding after a reship", () => {
    expect(codes(context({ priorResolution: "reship", reshipCount: 1 }))).toContain("ALREADY_RESOLVED");
  });

  it("denies reshipping a partly refunded order", () => {
    const ctx = context({ order: { status: "partially_refunded", amountCents: 4500, refundedCents: 500 } });
    expect(codes(ctx, { type: "reship" })).toContain("REFUND_ALREADY_ISSUED");
  });

  it("denies anything on a fully refunded order", () => {
    const ctx = context({ order: { status: "refunded", amountCents: 4500, refundedCents: 4500 } });
    expect(evaluateProposal(refund, ctx)).toMatchObject({ decision: "denied", reasons: [{ code: "NOTHING_LEFT_TO_REFUND" }] });
  });
});

describe("reship rules", () => {
  it("respects a store that doesn't reship", () => {
    const ctx = context({ policy: { ...context().policy, reshipAllowed: false } });
    expect(codes(ctx, { type: "reship" })).toContain("RESHIP_DISABLED");
  });

  it("stops at the reship limit", () => {
    expect(codes(context({ reshipCount: 1 }), { type: "reship" })).toContain("RESHIP_LIMIT_REACHED");
  });

  it("can't reship an order that never shipped", () => {
    expect(codes(context({ shipment: null }), { type: "reship" })).toContain("NOT_SHIPPED_YET");
  });

  it("doesn't reship for an unrecognized charge", () => {
    expect(codes(context({ issueType: "unrecognized_charge" }), { type: "reship" })).toContain("RESHIP_NOT_APPLICABLE");
  });
});

describe("other problem types", () => {
  it("sends refunds for unrecognized charges to the merchant", () => {
    expect(evaluateProposal(refund, context({ issueType: "unrecognized_charge" })).decision).toBe("needs_approval");
  });

  it("asks before cancelling an order that already shipped", () => {
    expect(codes(context({ issueType: "cancel" }))).toContain("CANCEL_AFTER_SHIPPING");
  });

  it("allows return-then-refund for a cancellation after shipping", () => {
    expect(evaluateProposal({ type: "return_then_refund" }, context({ issueType: "cancel" })).decision).toBe("allowed");
  });
});

describe("bad input and manipulation", () => {
  it("denies money on an unpaid order", () => {
    const result = evaluateProposal(refund, context({ order: { status: "created", amountCents: 4500, refundedCents: 0 } }));
    expect(result.reasons[0].code).toBe("ORDER_NOT_PAID");
  });

  it("denies money fixes on orders with no PayPal payment on file", () => {
    for (const type of ["full_refund", "reship"] as const) {
      const result = evaluateProposal({ type }, context({ order: { status: "captured", amountCents: 4500, refundedCents: 0, paidThroughPayPal: false } }));
      expect(result.decision).toBe("denied");
      expect(result.reasons[0].code).toBe("NOT_A_PAYPAL_PAYMENT");
    }
  });

  it.each([
    ["more than the order", 99900],
    ["the full amount (use a full refund)", 4500],
    ["zero", 0],
    ["negative", -500],
    ["fractional cents", 10.5],
  ])("denies a partial refund of %s", (_label, amountCents) => {
    const result = evaluateProposal({ type: "partial_refund", amountCents }, context());
    expect(result).toMatchObject({ decision: "denied", reasons: [{ code: "INVALID_AMOUNT" }] });
  });

  it("can't be talked into a bigger refund: the amount always comes from the order", () => {
    // Whatever the model passes for a full refund, the engine uses the refundable balance.
    const result = evaluateProposal({ type: "full_refund", amountCents: 50000 }, context());
    expect(result.amountCents).toBe(4500);
  });

  it("puts the deciding reasons first when several apply", () => {
    const ctx = context({ priorResolution: "refund", buyer: { tier: "watch", flagged: false } });
    const result = evaluateProposal(refund, ctx);
    expect(result.decision).toBe("denied");
    expect(result.reasons[0].decision).toBe("denied");
    expect(result.reasons.map((r) => r.code)).toEqual(["ALREADY_RESOLVED", "TRUST_TIER"]);
  });
});
