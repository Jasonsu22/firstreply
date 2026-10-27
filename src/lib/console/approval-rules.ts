/**
 * Rules for the merchant's approve/reject decision, kept pure for unit tests.
 *
 * A merchant's approval stands in for the "needs_approval" checks (trust tier, over the auto limit):
 * that's exactly what they're approving. Hard limits stay hard — nothing left to refund, not paid,
 * reship limit reached — so a stale approval can never move money the order doesn't allow.
 */
import { formatCents } from "@/lib/money";
import type { PolicyResult } from "@/lib/policy/engine";

export function approvalBlockers(result: Pick<PolicyResult, "decision" | "reasons">): string[] {
  if (result.decision !== "denied") return [];
  return result.reasons.filter((r) => r.decision === "denied").map((r) => r.message);
}

type OfferType = "full_refund" | "partial_refund" | "reship" | "return_then_refund";

/** The message the buyer sees in their chat after the store decides. Written by code, not the model. */
export function buyerUpdateMessage(input: {
  outcome: "approved" | "rejected";
  offerType: OfferType;
  amountCents: number | null;
  noteToBuyer?: string | null;
  replacement?: { carrier: string; trackingNumber: string } | null;
}): string {
  const amount = input.amountCents ? formatCents(input.amountCents) : "";
  const note = input.noteToBuyer?.trim() ? ` A note from the team: “${input.noteToBuyer.trim()}”` : "";

  if (input.outcome === "rejected") {
    const what = input.offerType === "reship" ? "a replacement" : input.offerType === "partial_refund" ? `a partial refund of ${amount}` : `a refund of ${amount}`;
    return `The store team reviewed your request for ${what} and couldn't approve it this time.${note} If there's anything else I can check for you, just reply here.`;
  }

  switch (input.offerType) {
    case "reship": {
      const tracking = input.replacement ? ` It ships with ${input.replacement.carrier}, tracking number ${input.replacement.trackingNumber}.` : "";
      return `Good news: the store team approved a free replacement for your order.${tracking}${note}`;
    }
    case "return_then_refund":
      return `Good news: the store team approved a return for a refund of ${amount}. Please send the item back unused in its packaging; the refund follows when it arrives.${note}`;
    default:
      return `Good news: the store team approved your refund of ${amount}. It has been sent to your original payment method and usually shows within 3–5 business days.${note}`;
  }
}
