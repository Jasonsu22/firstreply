/**
 * Sends the merchant's approved response to PayPal (PLAN.md §7.3). Only ever called from a merchant's click.
 *
 * Before sending, the dispute is re-fetched so we only use an action PayPal allows right now (the seller can be
 * locked out within minutes — docs/day1-setup.md). Every attempt is stored in dispute_submissions and the audit log.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cases, disputeDrafts, disputes, disputeSubmissions, orders, refunds } from "@/db/schema";
import { logAction } from "@/lib/agent/audit";
import type { MerchantSession } from "@/lib/merchant-session";
import { centsToPayPal } from "@/lib/money";
import { PayPalError, paypalRequest } from "@/lib/paypal/client";
import type { SubmitAction } from "./draft-rules";
import { buildEvidencePdf } from "./pdf";
import { buildDisputeRecord, type DisputeRecord } from "./record";
import { fetchDispute, upsertDispute } from "./sync";

export class SubmitError extends Error {}

type Draft = typeof disputeDrafts.$inferSelect;

function multipart(input: unknown, pdf: Uint8Array | null, fileField: string) {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
  if (pdf) form.append(fileField, new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "case-record.pdf");
  return form;
}

/** The PayPal request for one action. Tracking numbers and refund IDs come from the record, never the draft text. */
function buildRequest(action: SubmitAction, draft: Draft, record: DisputeRecord, pdf: Uint8Array) {
  const notes = draft.responseText;
  switch (action) {
    case "provide_evidence": {
      const types = new Set(draft.evidencePlan.map((e) => e.type));
      const evidences: Record<string, unknown>[] = [];
      const shipments = record.order?.shipments ?? [];
      const refundIds = (record.order?.refunds ?? []).map((r) => r.paypalRefundId).filter(Boolean);
      if (types.has("PROOF_OF_FULFILLMENT") && shipments.length) {
        evidences.push({
          evidence_type: "PROOF_OF_FULFILLMENT",
          evidence_info: { tracking_info: shipments.map((s) => ({ carrier_name: s.carrier, tracking_number: s.trackingNumber })) },
          notes,
        });
      }
      if (types.has("PROOF_OF_REFUND") && refundIds.length) evidences.push({ evidence_type: "PROOF_OF_REFUND", evidence_info: { refund_ids: refundIds }, notes });
      if (!evidences.length) evidences.push({ evidence_type: "OTHER", notes });
      const input = { evidences };
      return { path: "provide-evidence", body: multipart(input, pdf, "evidence-file"), log: { ...input, file: "case-record.pdf" } };
    }
    case "provide_supporting_info": {
      const input = { notes };
      return { path: "provide-supporting-info", body: multipart(input, pdf, "supporting-document"), log: { ...input, file: "case-record.pdf" } };
    }
    case "send_message":
      return { path: "send-message", body: { message: notes }, log: { message: notes } };
    case "make_offer": {
      const body = { note: notes, offer_type: "REFUND", offer_amount: { currency_code: record.dispute.currency, value: centsToPayPal(draft.offerAmountCents ?? 0) } };
      return { path: "make-offer", body, log: body };
    }
    case "accept_claim": {
      const body = { note: notes, accept_claim_type: "REFUND" };
      return { path: "accept-claim", body, log: body };
    }
  }
}

/** Records the refund PayPal makes when the seller accepts a claim, so the order and case stay accurate. */
async function recordAcceptedClaim(record: DisputeRecord, disputeRowId: string, caseId: string | null) {
  if (!record.order) return;
  const [order] = await db.select().from(orders).where(eq(orders.id, record.order.id));
  const amount = Math.min(record.dispute.amountCents, order.amountCents - order.refundedCents);
  if (amount <= 0) return;
  await db.transaction(async (tx) => {
    await tx.insert(refunds).values({ orderId: order.id, idempotencyKey: `dispute-accept-${disputeRowId}`, amountCents: amount, status: "completed" }).onConflictDoNothing();
    const refunded = order.refundedCents + amount;
    await tx
      .update(orders)
      .set({ refundedCents: refunded, status: refunded >= order.amountCents ? "refunded" : "partially_refunded" })
      .where(eq(orders.id, order.id));
    if (caseId) {
      await tx
        .update(cases)
        .set({ resolutionType: amount >= order.amountCents ? "full_refund" : "partial_refund", resolutionAmountCents: amount, resolvedAt: sql`now()` })
        .where(eq(cases.id, caseId));
    }
  });
}

/**
 * Sends a draft to PayPal. If the merchant edited the text, the edit is saved as a new merchant-authored version first.
 */
export async function submitDraft(session: MerchantSession, draftId: string, edits: { responseText?: string; action?: SubmitAction }) {
  const [row] = await db
    .select({ draft: disputeDrafts, dispute: disputes })
    .from(disputeDrafts)
    .innerJoin(disputes, eq(disputes.id, disputeDrafts.disputeId))
    .where(and(eq(disputeDrafts.id, draftId), eq(disputes.merchantId, session.merchantId)));
  if (!row) throw new SubmitError("Draft not found.");
  let draft = row.draft;
  const action = edits.action ?? draft.action;

  // Check with PayPal right now: the allowed actions change fast.
  const fresh = await upsertDispute(session.merchantId, await fetchDispute(row.dispute.paypalDisputeId), "manual");
  if (!fresh.dispute.allowedActions.includes(action)) {
    const now = fresh.dispute.allowedActions.length ? fresh.dispute.allowedActions.join(", ").replace(/_/g, " ") : "nothing (PayPal is reviewing)";
    throw new SubmitError(`PayPal no longer allows "${action.replace(/_/g, " ")}" on this dispute. Right now you can: ${now}.`);
  }

  const text = edits.responseText?.trim();
  if ((text && text !== draft.responseText) || action !== draft.action) {
    const [last] = await db.select({ version: disputeDrafts.version }).from(disputeDrafts).where(eq(disputeDrafts.disputeId, draft.disputeId)).orderBy(desc(disputeDrafts.version)).limit(1);
    [draft] = await db
      .insert(disputeDrafts)
      .values({ ...draft, id: undefined, version: last.version + 1, action, responseText: (text || draft.responseText).slice(0, 2000), createdBy: "merchant", model: null, createdAt: undefined })
      .returning();
  }

  const record = await buildDisputeRecord(draft.disputeId);
  const pdf = await buildEvidencePdf(record, draft);
  const request = buildRequest(action, draft, record, pdf);

  let response: unknown;
  let ok = true;
  let debugId: string | null = null;
  try {
    response = await paypalRequest(`/v1/customer/disputes/${encodeURIComponent(row.dispute.paypalDisputeId)}/${request.path}`, {
      method: "POST",
      body: request.body,
      requestId: `dispute-${draft.id}-${action}`,
    });
  } catch (err) {
    ok = false;
    response = err instanceof PayPalError ? err.body : { error: String(err) };
    debugId = err instanceof PayPalError ? ((err.body as { debug_id?: string })?.debug_id ?? null) : null;
  }

  await db.insert(disputeSubmissions).values({
    disputeId: draft.disputeId,
    draftId: draft.id,
    action,
    request: request.log,
    response: response ?? null,
    ok,
    paypalDebugId: debugId,
    submittedBy: session.userId,
  });
  await logAction({
    merchantId: session.merchantId,
    caseId: row.dispute.caseId,
    actor: "merchant",
    tool: `dispute_${action}`,
    args: { dispute_id: row.dispute.paypalDisputeId, draft_version: draft.version, by: session.email },
    agentReason: draft.responseText,
    result: response ?? null,
    status: ok ? "ok" : "error",
    paypalDebugId: debugId,
  });

  if (!ok) {
    const message = (response as { message?: string; details?: { description?: string }[] })?.details?.[0]?.description ?? (response as { message?: string })?.message ?? "PayPal rejected the request.";
    throw new SubmitError(`PayPal said: ${message}${debugId ? ` (debug id ${debugId})` : ""}`);
  }
  if (action === "accept_claim") await recordAcceptedClaim(record, row.dispute.id, row.dispute.caseId);

  // PayPal's view after our response (status / allowed actions usually change).
  const after = await upsertDispute(session.merchantId, await fetchDispute(row.dispute.paypalDisputeId), "manual");
  return { action, version: draft.version, status: after.dispute.status };
}
