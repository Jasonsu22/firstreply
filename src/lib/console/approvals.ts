/**
 * The merchant's approvals queue (PLAN.md §7.4): fixes the policy held back for a person to decide.
 * Approve → the fix runs through PayPal right away; reject → the buyer is told. Either way the buyer
 * gets a code-written message in their chat, and the decision goes into the audit log.
 */
import type { ModelMessage } from "ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { actions, approvals, buyers, cases, merchants, messages, offers, orders } from "@/db/schema";
import { logAction } from "@/lib/agent/audit";
import { appendMessages, updateCase } from "@/lib/agent/cases";
import { executeOffer, type ExecutionResult } from "@/lib/agent/execute";
import type { MerchantSession } from "@/lib/merchant-session";
import { loadPolicyContext } from "@/lib/policy/context";
import { evaluateProposal, type IssueType } from "@/lib/policy/engine";
import { effectiveTier } from "@/lib/policy/trust";
import { offerLabel } from "@/lib/help/state";
import { approvalBlockers, buyerUpdateMessage } from "./approval-rules";

export type ApprovalItem = {
  id: string;
  status: (typeof approvals.$inferSelect)["status"];
  caseId: string;
  offerType: (typeof offers.$inferSelect)["type"];
  offerLabel: string;
  amountCents: number | null;
  /** What the money/goods at stake is worth (reship = order value). */
  atStakeCents: number;
  requestedReason: string;
  agentNote: string | null;
  lastBuyerMessage: string | null;
  orderNumber: string;
  orderAmountCents: number;
  currency: string;
  issueType: string;
  buyerEmail: string;
  buyerName: string | null;
  buyerTier: string;
  tierReasons: string[];
  dueAt: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
};

export async function listApprovals(merchantId: string, which: "pending" | "decided", limit = 50): Promise<ApprovalItem[]> {
  const rows = await db
    .select({
      a: approvals,
      offer: offers,
      orderNumber: orders.orderNumber,
      orderAmountCents: orders.amountCents,
      currency: orders.currency,
      issueType: cases.issueType,
      buyer: buyers,
      agentNote: sql<string | null>`(SELECT x.agent_reason FROM ${actions} x WHERE x.case_id = ${cases.id} AND x.tool = 'propose_resolution' ORDER BY x.created_at DESC LIMIT 1)`,
      lastBuyerMessage: sql<string | null>`(SELECT m.text_preview FROM ${messages} m WHERE m.case_id = ${cases.id} AND m.role = 'buyer' ORDER BY m.seq DESC LIMIT 1)`,
    })
    .from(approvals)
    .innerJoin(offers, eq(offers.id, approvals.offerId))
    .innerJoin(cases, eq(cases.id, approvals.caseId))
    .innerJoin(orders, eq(orders.id, cases.orderId))
    .innerJoin(buyers, eq(buyers.id, cases.buyerId))
    .where(and(eq(cases.merchantId, merchantId), which === "pending" ? eq(approvals.status, "pending") : inArray(approvals.status, ["approved", "rejected", "expired"])))
    .orderBy(which === "pending" ? approvals.dueAt : desc(approvals.decidedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.a.id,
    status: r.a.status,
    caseId: r.a.caseId,
    offerType: r.offer.type,
    offerLabel: offerLabel(r.offer.type, r.offer.amountCents ?? r.orderAmountCents, r.currency),
    amountCents: r.offer.amountCents,
    atStakeCents: r.offer.amountCents ?? r.orderAmountCents,
    requestedReason: r.a.requestedReason,
    agentNote: r.agentNote,
    lastBuyerMessage: r.lastBuyerMessage,
    orderNumber: r.orderNumber,
    orderAmountCents: r.orderAmountCents,
    currency: r.currency,
    issueType: r.issueType,
    buyerEmail: r.buyer.email,
    buyerName: r.buyer.name,
    buyerTier: effectiveTier(r.buyer),
    tierReasons: r.buyer.tierReasons,
    dueAt: r.a.dueAt.toISOString(),
    createdAt: r.a.createdAt.toISOString(),
    decidedAt: r.a.decidedAt?.toISOString() ?? null,
    decisionNote: r.a.decisionNote,
  }));
}

export class ApprovalError extends Error {}

async function loadForDecision(session: MerchantSession, approvalId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new ApprovalError("Approval not found.");
  const [row] = await db
    .select({ approval: approvals, offer: offers, caseRow: cases, storeName: merchants.name })
    .from(approvals)
    .innerJoin(offers, eq(offers.id, approvals.offerId))
    .innerJoin(cases, eq(cases.id, approvals.caseId))
    .innerJoin(merchants, eq(merchants.id, cases.merchantId))
    .where(and(eq(approvals.id, approvalId), eq(cases.merchantId, session.merchantId)));
  if (!row) throw new ApprovalError("Approval not found.");
  if (row.approval.status !== "pending") throw new ApprovalError(`This was already ${row.approval.status}.`);
  return row;
}

/** Claims a pending approval so a double click (or two staff members) can't decide it twice. */
async function claim(approvalId: string, status: "approved" | "rejected", session: MerchantSession, note: string | null) {
  const [claimed] = await db
    .update(approvals)
    .set({ status, decidedBy: session.userId, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")))
    .returning();
  if (!claimed) throw new ApprovalError("Someone already decided this one.");
}

async function tellBuyer(caseId: string, text: string) {
  const message: ModelMessage = { role: "assistant", content: text };
  await appendMessages(caseId, [message]);
}

export async function approve(session: MerchantSession, approvalId: string, note?: string): Promise<ExecutionResult> {
  const { approval, offer, caseRow, storeName } = await loadForDecision(session, approvalId);

  // Re-check against the order as it is now. The approval covers "needs approval" reasons only.
  const ctx = await loadPolicyContext(caseRow.orderId, caseRow.issueType as IssueType);
  const recheck = evaluateProposal({ type: offer.type, amountCents: offer.type === "partial_refund" ? (offer.amountCents ?? undefined) : undefined }, ctx);
  const blockers = approvalBlockers(recheck);
  const args = { approval_id: approval.id, offer_id: offer.id, by: session.email };
  if (blockers.length) {
    await logAction({ merchantId: session.merchantId, caseId: caseRow.id, actor: "merchant", tool: "approve_offer", args, status: "blocked_by_policy", result: recheck, policyDecision: recheck.decision, policyReasons: blockers });
    throw new ApprovalError(`Can't approve: ${blockers.join(" ")}`);
  }

  await claim(approval.id, "approved", session, note?.trim() || null);
  await logAction({
    merchantId: session.merchantId,
    caseId: caseRow.id,
    actor: "merchant",
    tool: "approve_offer",
    args,
    agentReason: note?.trim() || null,
    status: "ok",
    result: { approved: true },
    policyDecision: "allowed",
    policyReasons: [`Approved by ${session.email}`],
  });

  let done: ExecutionResult;
  try {
    done = await executeOffer({ offer, caseRow, amountCents: recheck.amountCents ?? undefined, storeName, actor: "merchant", reason: note?.trim() || `Approved by ${session.email}` });
  } catch (err) {
    // PayPal refused (the failure is in the audit log): put it back in the queue so it can be retried.
    await db.update(approvals).set({ status: "pending", decidedBy: null, decidedAt: null }).where(eq(approvals.id, approval.id));
    await db.update(offers).set({ status: "pending_approval" }).where(eq(offers.id, offer.id));
    throw new ApprovalError(`PayPal didn't accept it: ${err instanceof Error ? err.message : String(err)}. It's back in the queue.`);
  }

  await tellBuyer(
    caseRow.id,
    buyerUpdateMessage({
      outcome: "approved",
      offerType: offer.type,
      amountCents: done.kind === "refund" ? done.amountCents : (recheck.amountCents ?? null),
      replacement: done.kind === "reship" ? { carrier: done.carrier, trackingNumber: done.trackingNumber } : null,
    }),
  );
  return done;
}

export async function reject(session: MerchantSession, approvalId: string, noteToBuyer?: string) {
  const { approval, offer, caseRow } = await loadForDecision(session, approvalId);
  const note = noteToBuyer?.trim() || null;
  await claim(approval.id, "rejected", session, note);
  await db.update(offers).set({ status: "rejected_by_merchant", answeredAt: new Date() }).where(eq(offers.id, offer.id));
  await updateCase(caseRow.id, { status: "open" });
  await logAction({
    merchantId: session.merchantId,
    caseId: caseRow.id,
    actor: "merchant",
    tool: "reject_offer",
    args: { approval_id: approval.id, offer_id: offer.id, by: session.email },
    agentReason: note,
    status: "ok",
    result: { rejected: true },
    policyDecision: "denied",
    policyReasons: [`Rejected by ${session.email}`],
  });
  await tellBuyer(caseRow.id, buyerUpdateMessage({ outcome: "rejected", offerType: offer.type, amountCents: offer.amountCents, noteToBuyer: note }));
}
