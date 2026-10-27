import { describe, expect, it } from "vitest";
import { issueTypeFor, mapDispute, orderKeys, type PayPalDispute } from "./map";

// Trimmed from the real sandbox dispute PP-R-NZI-10194628 (day 1).
const sandbox: PayPalDispute = {
  dispute_id: "PP-R-NZI-10194628",
  create_time: "2026-10-26T11:39:08.857Z",
  update_time: "2026-10-26T12:00:13.497Z",
  disputed_transactions: [{ buyer_transaction_id: "05640882RL599232H", seller_transaction_id: "4MR82598PY9428623", buyer: { email: "buyer@example.com" } }],
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "UNDER_REVIEW",
  dispute_amount: { currency_code: "USD", value: "25.00" },
  dispute_life_cycle_stage: "CHARGEBACK",
  links: [{ rel: "self" }, { rel: "accept_claim" }, { rel: "provide_supporting_info" }],
};

describe("mapDispute", () => {
  it("maps the sandbox payload", () => {
    const row = mapDispute(sandbox);
    expect(row).toMatchObject({
      paypalDisputeId: "PP-R-NZI-10194628",
      reason: "merchandise_or_service_not_received",
      stage: "chargeback",
      status: "UNDER_REVIEW",
      amountCents: 2500,
      currency: "USD",
      outcome: null,
      allowedActions: ["accept_claim", "provide_supporting_info"],
    });
    expect(row.createdAtPaypal).toEqual(new Date("2026-10-26T11:39:08.857Z"));
    expect(row.raw).not.toHaveProperty("links");
  });

  it("falls back for reasons and stages we don't model", () => {
    const row = mapDispute({ ...sandbox, reason: "PAYMENT_BY_OTHER_MEANS", dispute_life_cycle_stage: undefined });
    expect(row.reason).toBe("other");
    expect(row.stage).toBe("inquiry");
  });

  it("reads the outcome and the seller's deadline", () => {
    const row = mapDispute({ ...sandbox, seller_response_due_date: "2026-11-05T11:39:08.000Z", dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } });
    expect(row.outcome).toBe("won_by_seller");
    expect(row.sellerResponseDueAt).toEqual(new Date("2026-11-05T11:39:08.000Z"));
  });
});

describe("orderKeys", () => {
  it("finds the capture id and buyer email", () => {
    // The invoice number (our order number) is deliberately not a key: it repeats across databases.
    expect(orderKeys({ ...sandbox, disputed_transactions: [{ ...sandbox.disputed_transactions![0], invoice_number: "FR-20004" }] })).toEqual({
      captureIds: ["4MR82598PY9428623"],
      buyerEmail: "buyer@example.com",
    });
  });
});

describe("issueTypeFor", () => {
  it("maps PayPal reasons to case problem types", () => {
    expect(issueTypeFor("merchandise_or_service_not_received")).toBe("not_received");
    expect(issueTypeFor("unauthorised")).toBe("unrecognized_charge");
    expect(issueTypeFor("duplicate_transaction")).toBe("other");
  });
});
