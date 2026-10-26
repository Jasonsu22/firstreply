/**
 * Resolution Agent tools (PLAN.md §7.2).
 *
 * Guardrails live here, not in the prompt:
 * - every tool is bound to one order/case — none takes an order id, so the model can't reach other customers
 * - every call is written to the append-only audit log
 * - money moves only through propose_resolution → (buyer agrees) → accept_offer, and the
 *   policy engine is checked at both steps; amounts always come from the order, never the model
 */
import { tool } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { approvals, offers, orderItems, orders, policies, shipments } from "@/db/schema";
import { formatCents } from "@/lib/money";
import { runToolkitTool } from "@/lib/paypal/toolkit";
import { loadPolicyContext, recomputeBuyerTier } from "@/lib/policy/context";
import { evaluateProposal, type IssueType, type ProposalType } from "@/lib/policy/engine";
import { issueRefund } from "@/lib/refunds";
import { createReship } from "@/lib/shipping";
import { addFact, audited, logAction } from "./audit";
import { BUYER_GUIDANCE } from "./guidance";
import { updateCase, type Case } from "./cases";

export type AgentSession = { merchantId: string; storeName: string; orderId: string; caseRow: Case };

const ISSUE_TYPES = ["not_received", "not_as_described", "damaged", "unrecognized_charge", "cancel", "other"] as const;
const PROPOSAL_TYPES = ["full_refund", "partial_refund", "reship", "return_then_refund"] as const;

const PAYPAL_TO_LOCAL: Record<string, (typeof shipments.$inferSelect)["status"]> = {
  SHIPPED: "shipped",
  DELIVERY_SCHEDULED: "shipped",
  IN_TRANSIT: "shipped",
  ON_HOLD: "on_hold",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
};

type Tracker = { tracking_number?: string; status?: string; carrier?: string; shipment_date?: string; last_updated_time?: string };

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export function createResolutionTools(session: AgentSession) {
  const { merchantId, orderId } = session;
  const caseId = session.caseRow.id;
  const meta = (toolName: string, args: unknown, agentReason?: string) => ({
    merchantId,
    caseId,
    actor: "agent" as const,
    tool: toolName,
    args,
    agentReason,
  });

  return {
    get_order: tool({
      description:
        "Look up the buyer's order: items, total, payment status and where it ships. Read-only. Call this before discussing the order.",
      inputSchema: z.object({}),
      execute: async () => {
        const { result, actionId } = await audited(meta("get_order", {}), async () => {
          const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
          const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
          const paypal = order.paypalOrderId
            ? ((await runToolkitTool("get_order", { id: order.paypalOrderId })) as {
                status?: string;
                purchase_units?: { payments?: { captures?: { status?: string }[] } }[];
              })
            : null;
          return {
            order_number: order.orderNumber,
            placed_on: dateOnly(order.capturedAt ?? order.createdAt),
            items: items.map((i) => ({ name: i.name, quantity: i.quantity, price: formatCents(i.unitPriceCents) })),
            total: formatCents(order.amountCents),
            already_refunded: formatCents(order.refundedCents),
            paypal_order_status: paypal?.status ?? "unknown",
            payment_status: paypal?.purchase_units?.[0]?.payments?.captures?.[0]?.status ?? "unknown",
            ships_to: [order.shippingAddress?.admin_area_2, order.shippingAddress?.admin_area_1].filter(Boolean).join(", "),
            statement_descriptor: order.softDescriptor,
          };
        });
        await addFact(caseId, "order_details", result, actionId);
        return result;
      },
    }),

    get_shipment_status: tool({
      description:
        "Check live tracking for the order from PayPal: carrier, tracking number, status (shipped, on_hold, delivered, lost, cancelled) and dates. Always call this before discussing delivery.",
      inputSchema: z.object({}),
      execute: async () => {
        const { result, actionId } = await audited(meta("get_shipment_status", {}), async () => {
          const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
          const [shipment] = await db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.shippedAt));
          if (!shipment) return { shipped: false as const, note: "The order hasn't shipped yet; it ships within 1 business day." };

          const tracking = (await runToolkitTool("get_shipment_tracking", {
            order_id: order.paypalOrderId,
            transaction_id: order.paypalCaptureId,
          })) as { trackers?: Tracker[] };
          // PayPal keeps one record per update of the same tracking number: use the newest.
          const latest = (tracking.trackers ?? [])
            .filter((t) => t.tracking_number === shipment.trackingNumber)
            .sort((a, b) => Number(b.last_updated_time ?? 0) - Number(a.last_updated_time ?? 0))[0];
          const paypalStatus = latest?.status ?? "UNKNOWN";
          // "lost" exists only on our side (PayPal shows ON_HOLD), so keep it when PayPal says ON_HOLD.
          const status = shipment.status === "lost" && paypalStatus === "ON_HOLD" ? "lost" : (PAYPAL_TO_LOCAL[paypalStatus] ?? shipment.status);

          const [policy] = await db.select().from(policies).where(eq(policies.merchantId, merchantId));
          const expectedBy = new Date(shipment.shippedAt.getTime() + (policy?.notReceivedWaitDays ?? 7) * 864e5);
          const daysSinceShipped = Math.floor((Date.now() - shipment.shippedAt.getTime()) / 864e5);
          return {
            shipped: true as const,
            carrier: shipment.carrier,
            tracking_number: shipment.trackingNumber,
            status,
            paypal_tracker_status: paypalStatus,
            shipped_on: dateOnly(shipment.shippedAt),
            days_since_shipped: daysSinceShipped,
            normal_delivery_window_ends: dateOnly(expectedBy),
            is_replacement: shipment.isReship,
            checked_at: new Date().toISOString(),
          };
        });
        if (result.shipped) {
          await addFact(caseId, "tracking_status", { status: result.status, tracking_number: result.tracking_number, checked_at: result.checked_at }, actionId);
          if (result.status === "delivered") await addFact(caseId, "delivery_confirmed", { tracking_number: result.tracking_number }, actionId);
        }
        return result;
      },
    }),

    update_issue_type: tool({
      description: "Correct the type of problem if the buyer's first message was misread or the problem turns out to be different.",
      inputSchema: z.object({ issue_type: z.enum(ISSUE_TYPES), reason: z.string().max(300) }),
      execute: async ({ issue_type, reason }) => {
        await updateCase(caseId, { issueType: issue_type });
        session.caseRow = { ...session.caseRow, issueType: issue_type };
        await logAction({ ...meta("update_issue_type", { issue_type }, reason), status: "ok", result: { issue_type } });
        return { ok: true, issue_type };
      },
    }),

    propose_resolution: tool({
      description:
        "Ask the store's policy whether a fix may be offered. Returns allowed (offer it to the buyer and ask them to confirm), needs_approval (the store team decides; tell the buyer when they'll hear back) or denied (with guidance). Never promise a refund or replacement before this returns allowed. Amounts for full refunds come from the order automatically.",
      inputSchema: z.object({
        type: z.enum(PROPOSAL_TYPES),
        partial_amount_cents: z.number().int().positive().optional().describe("Only for partial_refund: amount in cents"),
        reason: z.string().max(500).describe("Why this fix fits, based on facts you checked"),
      }),
      execute: async ({ type, partial_amount_cents, reason }) => {
        const ctx = await loadPolicyContext(orderId, session.caseRow.issueType as IssueType);
        const decision = evaluateProposal({ type: type as ProposalType, amountCents: partial_amount_cents }, ctx);
        const guidance = decision.reasons.map((r) => BUYER_GUIDANCE[r.code]);

        const action = await logAction({
          ...meta("propose_resolution", { type, partial_amount_cents }, reason),
          status: decision.decision === "denied" ? "blocked_by_policy" : "ok",
          result: decision,
          policyDecision: decision.decision,
          policyReasons: decision.reasons.map((r) => r.message),
        });
        if (decision.decision === "denied") return { decision: "denied" as const, guidance };

        // One open offer at a time: a new proposal replaces any unanswered one.
        await db
          .update(offers)
          .set({ status: "expired" })
          .where(and(eq(offers.caseId, caseId), eq(offers.status, "offered")));

        const allowed = decision.decision === "allowed";
        const [offer] = await db
          .insert(offers)
          .values({
            caseId,
            type,
            amountCents: type === "reship" ? null : decision.amountCents,
            policyDecision: decision.decision,
            status: allowed ? "offered" : "pending_approval",
            offeredAt: allowed ? new Date() : null,
          })
          .returning();
        await addFact(caseId, "offer_made", { offer_id: offer.id, type, amount_cents: offer.amountCents, decision: decision.decision }, action.id);

        if (allowed) {
          await updateCase(caseId, { status: "awaiting_buyer" });
          return {
            decision: "allowed" as const,
            offer_id: offer.id,
            type,
            amount: offer.amountCents ? formatCents(offer.amountCents) : null,
            next_step: "Offer this to the buyer in plain words and ask them to confirm. Only call accept_offer after they clearly say yes.",
          };
        }

        const [policy] = await db.select().from(policies).where(eq(policies.merchantId, merchantId));
        const slaHours = policy?.approvalSlaHours ?? 24;
        await db.insert(approvals).values({
          offerId: offer.id,
          caseId,
          requestedReason: decision.reasons.map((r) => r.message).join(" "),
          dueAt: new Date(Date.now() + slaHours * 3600_000),
        });
        await updateCase(caseId, { status: "awaiting_merchant" });
        return { decision: "needs_approval" as const, store_replies_within_hours: slaHours, guidance };
      },
    }),

    accept_offer: tool({
      description:
        "Carry out an offer the buyer has clearly accepted (they said yes to this exact offer). Issues the refund or sends the replacement through PayPal. Never call this without the buyer's explicit yes.",
      inputSchema: z.object({ offer_id: z.string().uuid(), buyer_words: z.string().max(300).describe("The buyer's words accepting the offer") }),
      execute: async ({ offer_id, buyer_words }) => {
        const [offer] = await db.select().from(offers).where(and(eq(offers.id, offer_id), eq(offers.caseId, caseId)));
        if (!offer || offer.status !== "offered") {
          return { ok: false, error: "That offer isn't open. Propose a fix again if needed." };
        }

        // Re-check policy right before money moves: the situation may have changed since the offer.
        const ctx = await loadPolicyContext(orderId, session.caseRow.issueType as IssueType);
        const recheck = evaluateProposal({ type: offer.type, amountCents: offer.type === "partial_refund" ? (offer.amountCents ?? undefined) : undefined }, ctx);
        if (recheck.decision !== "allowed") {
          await db.update(offers).set({ status: "expired" }).where(eq(offers.id, offer.id));
          await logAction({ ...meta("accept_offer", { offer_id }, buyer_words), status: "blocked_by_policy", result: recheck, policyDecision: recheck.decision });
          return { ok: false, error: "This fix is no longer available.", guidance: recheck.reasons.map((r) => BUYER_GUIDANCE[r.code]) };
        }

        await db.update(offers).set({ status: "accepted", answeredAt: new Date() }).where(eq(offers.id, offer.id));

        if (offer.type === "return_then_refund") {
          await updateCase(caseId, { status: "awaiting_buyer" });
          await logAction({ ...meta("accept_offer", { offer_id }, buyer_words), status: "ok", result: { return_requested: true } });
          return { ok: true, next_step: "Give return instructions: send the item back unused in its packaging; the refund follows when it arrives." };
        }

        if (offer.type === "reship") {
          const { result: shipment, actionId } = await audited(meta("create_reship", { offer_id }, buyer_words), () => createReship(orderId));
          await db.update(offers).set({ status: "executed", executedAt: new Date(), executedActionId: actionId }).where(eq(offers.id, offer.id));
          await updateCase(caseId, { status: "resolved", resolutionType: "reship", resolvedAt: new Date() });
          await recomputeBuyerTier(session.caseRow.buyerId);
          return { ok: true, replacement: { carrier: shipment.carrier, tracking_number: shipment.trackingNumber } };
        }

        const amountCents = recheck.amountCents!;
        const { result, actionId } = await audited(meta("issue_refund", { offer_id, amount_cents: amountCents }, buyer_words), () =>
          issueRefund({
            orderId,
            offerId: offer.id,
            amountCents,
            idempotencyKey: `offer-${offer.id}`,
            noteToPayer: `Refund from ${session.storeName} — sorry for the trouble with your order.`,
          }),
        );
        await addFact(caseId, "refund_issued", { amount_cents: amountCents, paypal_refund_id: result.refund.paypalRefundId }, actionId);
        await db.update(offers).set({ status: "executed", executedAt: new Date(), executedActionId: actionId }).where(eq(offers.id, offer.id));
        await updateCase(caseId, {
          status: "resolved",
          resolutionType: offer.type === "partial_refund" ? "partial_refund" : "full_refund",
          resolutionAmountCents: amountCents,
          resolvedAt: new Date(),
        });
        await recomputeBuyerTier(session.caseRow.buyerId);
        return { ok: true, refunded: formatCents(amountCents), paypal_refund_id: result.refund.paypalRefundId, arrives: "usually within 3–5 business days, back to the original payment method" };
      },
    }),

    decline_offer: tool({
      description: "Record that the buyer declined an offer (keep their reason). This is part of the case record.",
      inputSchema: z.object({ offer_id: z.string().uuid(), buyer_reason: z.string().max(500) }),
      execute: async ({ offer_id, buyer_reason }) => {
        const [offer] = await db.select().from(offers).where(and(eq(offers.id, offer_id), eq(offers.caseId, caseId)));
        if (!offer || offer.status !== "offered") return { ok: false, error: "That offer isn't open." };
        await db.update(offers).set({ status: "declined", answeredAt: new Date() }).where(eq(offers.id, offer.id));
        const action = await logAction({ ...meta("decline_offer", { offer_id }, buyer_reason), status: "ok", result: { declined: true } });
        await addFact(caseId, "offer_declined", { offer_id, type: offer.type, buyer_reason }, action.id);
        return { ok: true };
      },
    }),

    record_inconsistency: tool({
      description:
        "Record a factual mismatch you verified with a tool (e.g. 'buyer says not delivered; tracking shows DELIVERED on 2026-11-02'). Facts only — never opinions about the buyer's honesty.",
      inputSchema: z.object({ observation: z.string().max(500) }),
      execute: async ({ observation }) => {
        const action = await logAction({ ...meta("record_inconsistency", { observation }), status: "ok", result: { recorded: true } });
        await addFact(caseId, "inconsistency", { observation }, action.id);
        return { ok: true };
      },
    }),

    escalate_to_human: tool({
      description: "Hand the case to the store team when you can't resolve it, the buyer asks for a person, or something seems off.",
      inputSchema: z.object({ summary: z.string().max(800).describe("Short factual summary for the store team") }),
      execute: async ({ summary }) => {
        await updateCase(caseId, { status: "escalated", summary });
        await logAction({ ...meta("escalate_to_human", {}, summary), status: "ok", result: { escalated: true } });
        const [policy] = await db.select().from(policies).where(eq(policies.merchantId, merchantId));
        return { ok: true, store_replies_within_hours: policy?.approvalSlaHours ?? 24 };
      },
    }),

    mark_resolved: tool({
      description: "Close the case when the buyer's question is answered without any refund or replacement (e.g. they recognized the charge, or the parcel arrived).",
      inputSchema: z.object({ summary: z.string().max(500) }),
      execute: async ({ summary }) => {
        await updateCase(caseId, { status: "resolved", resolutionType: "explained", resolvedAt: new Date(), summary });
        await logAction({ ...meta("mark_resolved", {}, summary), status: "ok", result: { resolved: true } });
        return { ok: true };
      },
    }),
  };
}

export type ResolutionTools = ReturnType<typeof createResolutionTools>;
