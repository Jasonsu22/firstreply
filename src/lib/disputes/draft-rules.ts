/** The dispute draft's shape and the code-side checks on it. Pure, so it's unit-tested (draft-rules.test.ts). */
import { z } from "zod";
import type { DisputeRecord } from "./record";

export const SUBMIT_ACTIONS = ["provide_evidence", "provide_supporting_info", "make_offer", "accept_claim", "send_message"] as const;
export type SubmitAction = (typeof SUBMIT_ACTIONS)[number];

const EVIDENCE_TYPES = ["PROOF_OF_FULFILLMENT", "PROOF_OF_REFUND", "OTHER"] as const;

export function draftSchema(allowed: SubmitAction[]) {
  return z.object({
    recommendation: z.enum(["fight", "offer", "accept"]),
    action: z.enum(allowed as [SubmitAction, ...SubmitAction[]]).describe("The PayPal action to take — one PayPal currently allows"),
    reasoning: z.string().describe("For the store owner: why, in 2–4 sentences, including the main risk"),
    response_text: z.string().describe("What PayPal's reviewer reads (notes / message / offer note)"),
    evidence: z
      .array(z.object({ type: z.enum(EVIDENCE_TYPES), description: z.string(), source: z.string().describe("Where in the record this comes from") }))
      .describe("Evidence from the record that supports the response"),
    offer_amount_dollars: z.number().nullable().describe("Only for make_offer: the refund amount in dollars; otherwise null"),
  });
}

export type DraftInput = z.infer<ReturnType<typeof draftSchema>>;

/** Code-side checks on the model's draft: allowed action, honest evidence, sane amounts. */
export function checkDraft(draft: DraftInput, record: Pick<DisputeRecord, "dispute" | "order">) {
  const warnings: string[] = [];
  const hasTracking = !!record.order?.shipments.length;
  const delivered = record.order?.shipments.some((s) => s.status === "delivered") ?? false;
  const hasRefund = !!record.order?.refunds.length;

  const evidence: DraftInput["evidence"] = [];
  for (const e of draft.evidence) {
    if (e.type === "PROOF_OF_FULFILLMENT" && !hasTracking) warnings.push("Removed proof of fulfillment: no shipment on file.");
    else if (e.type === "PROOF_OF_REFUND" && !hasRefund) warnings.push("Removed proof of refund: no refund on file.");
    else evidence.push(e);
  }
  if (draft.recommendation === "fight" && record.dispute.reason === "merchandise_or_service_not_received" && !delivered) {
    warnings.push("Tracking doesn't show delivery, so a \"not received\" claim is hard to win. Consider accepting or offering instead.");
  }
  if (draft.action === "provide_evidence" && record.dispute.reason === "merchandise_or_service_not_received" && !evidence.some((e) => e.type !== "OTHER")) {
    warnings.push("PayPal rejects \"Other\" evidence on not-received cases; it needs tracking or a refund ID.");
  }

  const refundable = record.order ? record.order.totalCents - record.order.refundedCents : record.dispute.amountCents;
  let offerAmountCents: number | null = null;
  if (draft.action === "make_offer") {
    const asked = Math.round((draft.offer_amount_dollars ?? 0) * 100);
    offerAmountCents = Math.min(Math.max(asked, 1), refundable);
    if (offerAmountCents !== asked) warnings.push(`Offer amount adjusted to what's refundable.`);
  }
  return { evidence, offerAmountCents, warnings };
}
