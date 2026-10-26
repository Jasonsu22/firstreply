import type { ReasonCode } from "@/lib/policy/engine";

/**
 * What the agent may tell the buyer for each policy reason. Deliberately free of
 * internal limits, trust tiers and amounts (PLAN.md §7.6, §7.8).
 */
export const BUYER_GUIDANCE: Record<ReasonCode, string> = {
  NO_MONEY_INVOLVED: "Explain clearly.",
  ORDER_NOT_PAID: "This order isn't paid, so there's nothing to refund. Explain kindly.",
  NOTHING_LEFT_TO_REFUND: "This order has already been fully refunded. Tell the buyer and mention refunds can take a few days to show.",
  INVALID_AMOUNT: "That amount isn't possible for this order. Pick a smaller partial refund or a full refund.",
  ALREADY_RESOLVED: "This order was already resolved. Explain what was done; don't offer a second fix.",
  RESHIP_DISABLED: "This store doesn't send replacements. Offer a refund instead.",
  RESHIP_LIMIT_REACHED: "A replacement was already sent once. Offer a refund instead.",
  NOT_SHIPPED_YET: "The order hasn't shipped yet, so a replacement doesn't apply. A refund (cancellation) may.",
  REFUND_ALREADY_ISSUED: "Part of this order was already refunded, so a replacement isn't possible.",
  RESHIP_NOT_APPLICABLE: "A replacement doesn't fit this problem.",
  TOO_EARLY: "The parcel is still within its normal delivery window. Share the expected-by date, reassure the buyer, and invite them to come back if it hasn't arrived by then. Don't offer money yet.",
  DELIVERED_PER_TRACKING: "Tracking says delivered. Suggest checking with neighbours, the building's mailroom and around the door; the store team will review.",
  UNRECOGNIZED_CHARGE: "First help the buyer recognize the purchase (what, when, where it shipped). A refund for an unrecognized charge is reviewed by the store team.",
  CANCEL_AFTER_SHIPPING: "The order already shipped; offer return-then-refund, or the store team will review a cancellation.",
  TRUST_TIER: "The store team reviews this fix personally.",
  BUYER_FLAGGED: "The store team reviews this fix personally.",
  OVER_AUTO_LIMIT: "The store team approves fixes of this size personally.",
  WITHIN_POLICY: "You can offer this.",
};
