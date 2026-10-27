/**
 * Carries out an agreed fix: the refund or replacement goes through PayPal, the offer and case are closed,
 * and the buyer's tier is recomputed. Shared by the agent's accept_offer tool (buyer said yes) and the
 * merchant's approval in the console (store said yes) — so both paths move money the same way.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { offers } from "@/db/schema";
import { recomputeBuyerTier } from "@/lib/policy/context";
import { issueRefund } from "@/lib/refunds";
import { createReship } from "@/lib/shipping";
import { addFact, audited, logAction, type ActionMeta } from "./audit";
import { updateCase, type Case } from "./cases";

type Offer = typeof offers.$inferSelect;

export type ExecutionResult =
  | { kind: "return_requested" }
  | { kind: "reship"; carrier: string; trackingNumber: string }
  | { kind: "refund"; amountCents: number; paypalRefundId: string | null };

export async function executeOffer(input: {
  offer: Offer;
  caseRow: Case;
  /** Refund amount from the policy re-check (never from the model). */
  amountCents: number | undefined;
  storeName: string;
  actor: ActionMeta["actor"];
  /** Why: the buyer's words, or the merchant's approval note. */
  reason: string;
  extraArgs?: Record<string, unknown>;
}): Promise<ExecutionResult> {
  const { offer, caseRow, actor, reason } = input;
  const meta = (tool: string, args: Record<string, unknown>) => ({
    merchantId: caseRow.merchantId,
    caseId: caseRow.id,
    actor,
    tool,
    args: { ...args, ...input.extraArgs },
    agentReason: reason,
  });

  await db.update(offers).set({ status: "accepted", answeredAt: offer.answeredAt ?? new Date() }).where(eq(offers.id, offer.id));

  if (offer.type === "return_then_refund") {
    await updateCase(caseRow.id, { status: "awaiting_buyer" });
    await logAction({ ...meta("accept_offer", { offer_id: offer.id }), status: "ok", result: { return_requested: true } });
    return { kind: "return_requested" };
  }

  if (offer.type === "reship") {
    const { result: shipment, actionId } = await audited(meta("create_reship", { offer_id: offer.id }), () => createReship(caseRow.orderId));
    await db.update(offers).set({ status: "executed", executedAt: new Date(), executedActionId: actionId }).where(eq(offers.id, offer.id));
    await updateCase(caseRow.id, { status: "resolved", resolutionType: "reship", resolvedAt: new Date() });
    await recomputeBuyerTier(caseRow.buyerId);
    return { kind: "reship", carrier: shipment.carrier, trackingNumber: shipment.trackingNumber };
  }

  const amountCents = input.amountCents!;
  const { result, actionId } = await audited(meta("issue_refund", { offer_id: offer.id, amount_cents: amountCents }), () =>
    issueRefund({
      orderId: caseRow.orderId,
      offerId: offer.id,
      amountCents,
      idempotencyKey: `offer-${offer.id}`,
      noteToPayer: `Refund from ${input.storeName} — sorry for the trouble with your order.`,
    }),
  );
  await addFact(caseRow.id, "refund_issued", { amount_cents: amountCents, paypal_refund_id: result.refund.paypalRefundId }, actionId);
  await db.update(offers).set({ status: "executed", executedAt: new Date(), executedActionId: actionId }).where(eq(offers.id, offer.id));
  await updateCase(caseRow.id, {
    status: "resolved",
    resolutionType: offer.type === "partial_refund" ? "partial_refund" : "full_refund",
    resolutionAmountCents: amountCents,
    resolvedAt: new Date(),
  });
  await recomputeBuyerTier(caseRow.buyerId);
  return { kind: "refund", amountCents, paypalRefundId: result.refund.paypalRefundId };
}
