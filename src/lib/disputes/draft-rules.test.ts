import { describe, expect, it } from "vitest";
import { checkDraft, type DraftInput } from "./draft-rules";

const lostOrder = {
  dispute: { reason: "merchandise_or_service_not_received" as const, amountCents: 64500 },
  order: {
    totalCents: 64500,
    refundedCents: 0,
    shipments: [{ carrier: "UPS", trackingNumber: "1Z1", status: "lost" as const, shippedAt: new Date(), isReplacement: false }],
    refunds: [],
  },
};

const draft = (patch: Partial<DraftInput>): DraftInput => ({
  recommendation: "accept",
  action: "accept_claim",
  reasoning: "r",
  response_text: "t",
  evidence: [],
  offer_amount_dollars: null,
  ...patch,
});

// checkDraft only reads the fields above; cast for the full record type.
const check = (d: DraftInput, r = lostOrder) => checkDraft(d, r as unknown as Parameters<typeof checkDraft>[1]);

describe("checkDraft", () => {
  it("warns when fighting a not-received claim without proof of delivery", () => {
    const { warnings } = check(draft({ recommendation: "fight", action: "provide_supporting_info" }));
    expect(warnings.join(" ")).toMatch(/hard to win/);
  });

  it("drops evidence the record doesn't have", () => {
    const { evidence, warnings } = check(
      draft({
        evidence: [
          { type: "PROOF_OF_REFUND", description: "refund", source: "refunds" },
          { type: "PROOF_OF_FULFILLMENT", description: "UPS 1Z1", source: "shipment" },
        ],
      }),
    );
    expect(evidence.map((e) => e.type)).toEqual(["PROOF_OF_FULFILLMENT"]);
    expect(warnings).toContain("Removed proof of refund: no refund on file.");
  });

  it("keeps offers within what's refundable", () => {
    expect(check(draft({ recommendation: "offer", action: "make_offer", offer_amount_dollars: 900 })).offerAmountCents).toBe(64500);
    expect(check(draft({ recommendation: "offer", action: "make_offer", offer_amount_dollars: 100 })).offerAmountCents).toBe(10000);
  });

  it("warns that PayPal rejects 'Other' evidence on not-received cases", () => {
    const { warnings } = check(draft({ recommendation: "fight", action: "provide_evidence", evidence: [{ type: "OTHER", description: "chat", source: "conversation" }] }));
    expect(warnings.join(" ")).toMatch(/rejects "Other"/);
  });
});
