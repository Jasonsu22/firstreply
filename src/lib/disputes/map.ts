/**
 * Turns a PayPal dispute (GET /v1/customer/disputes/{id}) into our row, and says how to find its order.
 * Pure, so it's unit-tested against the shape the sandbox actually returns (see docs/day1-setup.md).
 */
import type { disputes } from "@/db/schema";
import type { IssueType } from "@/lib/policy/engine";
import { payPalToCents } from "@/lib/money";

type DisputeRow = typeof disputes.$inferInsert;
type Money = { currency_code?: string; value?: string };

export type PayPalDispute = {
  dispute_id: string;
  create_time: string;
  update_time?: string;
  reason?: string;
  status?: string;
  dispute_state?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: Money;
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  dispute_outcome?: { outcome_code?: string; amount_refunded?: Money };
  disputed_transactions?: {
    seller_transaction_id?: string;
    buyer_transaction_id?: string;
    invoice_number?: string;
    custom?: string;
    buyer?: { email?: string };
  }[];
  links?: { rel: string; href?: string; method?: string }[];
};

const REASONS = new Set<DisputeRow["reason"]>([
  "merchandise_or_service_not_received",
  "merchandise_or_service_not_as_described",
  "unauthorised",
  "credit_not_processed",
  "duplicate_transaction",
  "incorrect_amount",
  "other",
]);

const STAGES = new Set<DisputeRow["stage"]>(["inquiry", "chargeback", "pre_arbitration", "arbitration"]);

const OUTCOMES: Record<string, NonNullable<DisputeRow["outcome"]>> = {
  RESOLVED_BUYER_FAVOUR: "won_by_buyer",
  RESOLVED_SELLER_FAVOUR: "won_by_seller",
  RESOLVED_WITH_PAYOUT: "settled",
  ACCEPTED: "won_by_buyer",
  DENIED: "won_by_seller",
  CANCELED_BY_BUYER: "cancelled",
};

export function mapDispute(d: PayPalDispute): Omit<DisputeRow, "merchantId" | "orderId" | "caseId" | "buyerId"> {
  const reason = (d.reason ?? "OTHER").toLowerCase() as DisputeRow["reason"];
  const stage = (d.dispute_life_cycle_stage ?? "INQUIRY").toLowerCase() as DisputeRow["stage"];
  const due = d.seller_response_due_date;
  const { links, ...raw } = d;
  return {
    paypalDisputeId: d.dispute_id,
    reason: REASONS.has(reason) ? reason : "other",
    stage: STAGES.has(stage) ? stage : "inquiry",
    status: d.status ?? "UNKNOWN",
    amountCents: payPalToCents(d.dispute_amount?.value ?? "0"),
    currency: d.dispute_amount?.currency_code ?? "USD",
    sellerResponseDueAt: due ? new Date(due) : null,
    outcome: d.dispute_outcome?.outcome_code ? (OUTCOMES[d.dispute_outcome.outcome_code] ?? null) : null,
    allowedActions: (links ?? []).map((l) => l.rel).filter((rel) => rel !== "self"),
    raw,
    createdAtPaypal: new Date(d.create_time),
    updatedAtPaypal: d.update_time ? new Date(d.update_time) : null,
  };
}

/** What identifies the disputed order: our capture IDs first, then the invoice number (= our order number). */
export function orderKeys(d: PayPalDispute) {
  const txns = d.disputed_transactions ?? [];
  return {
    captureIds: txns.map((t) => t.seller_transaction_id).filter((v): v is string => !!v),
    invoiceNumbers: txns.map((t) => t.invoice_number).filter((v): v is string => !!v),
    buyerEmail: txns.find((t) => t.buyer?.email)?.buyer?.email ?? null,
  };
}

/** The case problem type a dispute reason corresponds to, for disputes with no FirstReply case yet. */
export function issueTypeFor(reason: DisputeRow["reason"]): IssueType {
  switch (reason) {
    case "merchandise_or_service_not_received":
      return "not_received";
    case "merchandise_or_service_not_as_described":
      return "not_as_described";
    case "unauthorised":
      return "unrecognized_charge";
    default:
      return "other";
  }
}

const REASON_LABEL: Record<string, string> = {
  merchandise_or_service_not_received: "Item not received",
  merchandise_or_service_not_as_described: "Not as described",
  unauthorised: "Unauthorized payment",
  credit_not_processed: "Refund not processed",
  duplicate_transaction: "Duplicate charge",
  incorrect_amount: "Wrong amount",
  other: "Other",
};

export const disputeReasonLabel = (reason: string) => REASON_LABEL[reason] ?? reason;

/** "WAITING_FOR_SELLER_RESPONSE" → "Waiting for seller response". */
export const humanStatus = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");

const STAGE_LABEL: Record<string, string> = { inquiry: "inquiry", chargeback: "claim", pre_arbitration: "pre-arbitration", arbitration: "arbitration" };

/** PayPal's stage in the words its Resolution Center uses ("chargeback" is shown to sellers as a claim). */
export const disputeStageLabel = (stage: string) => STAGE_LABEL[stage] ?? stage.replace(/_/g, "-");
