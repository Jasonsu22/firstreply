import { describe, expect, it } from "vitest";
import { approvalBlockers, buyerUpdateMessage } from "./approval-rules";

describe("approvalBlockers", () => {
  it("lets the merchant approve what the policy held for approval", () => {
    expect(
      approvalBlockers({
        decision: "needs_approval",
        reasons: [
          { code: "TRUST_TIER", decision: "needs_approval", message: "Buyer is on Watch." },
          { code: "OVER_AUTO_LIMIT", decision: "needs_approval", message: "Over the limit." },
        ],
      }),
    ).toEqual([]);
  });

  it("keeps hard limits even after approval", () => {
    expect(
      approvalBlockers({
        decision: "denied",
        reasons: [
          { code: "NOTHING_LEFT_TO_REFUND", decision: "denied", message: "Already fully refunded." },
          { code: "TRUST_TIER", decision: "needs_approval", message: "Buyer is on Watch." },
        ],
      }),
    ).toEqual(["Already fully refunded."]);
  });
});

describe("buyerUpdateMessage", () => {
  it("confirms an approved refund with the amount and timing", () => {
    const text = buyerUpdateMessage({ outcome: "approved", offerType: "full_refund", amountCents: 4500 });
    expect(text).toContain("approved your refund of $45.00");
    expect(text).toContain("3–5 business days");
  });

  it("gives the replacement's tracking number", () => {
    const text = buyerUpdateMessage({ outcome: "approved", offerType: "reship", amountCents: null, replacement: { carrier: "UPS", trackingNumber: "1Z999" } });
    expect(text).toContain("free replacement");
    expect(text).toContain("UPS, tracking number 1Z999");
  });

  it("is polite on rejection and passes the team's note", () => {
    const text = buyerUpdateMessage({ outcome: "rejected", offerType: "full_refund", amountCents: 4500, noteToBuyer: "Tracking shows it was delivered to your porch." });
    expect(text).toContain("couldn't approve it");
    expect(text).toContain("“Tracking shows it was delivered to your porch.”");
  });

  it("leaves out an empty note", () => {
    expect(buyerUpdateMessage({ outcome: "rejected", offerType: "reship", amountCents: null, noteToBuyer: "  " })).not.toContain("note from the team");
  });
});
