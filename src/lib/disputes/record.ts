/**
 * The case record behind a dispute (PLAN.md §7.3): everything that happened, from our own audit log and PayPal.
 * The dispute agent reads it, the evidence PDF prints it, and nothing in it comes from the model.
 */
import type { ModelMessage } from "ai";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actions, cases, disputes, merchants, messages, offers, orderItems, orders, refunds, shipments } from "@/db/schema";
import { describeAction } from "@/lib/console/timeline";
import type { PayPalDispute } from "./map";

export type DisputeRecord = Awaited<ReturnType<typeof buildDisputeRecord>>;

function textOf(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("").trim();
}

export async function buildDisputeRecord(disputeId: string) {
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!dispute) throw new Error("Dispute not found");
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, dispute.merchantId));
  const raw = (dispute.raw ?? {}) as PayPalDispute & { evidences?: { evidence_type?: string; notes?: string; source?: string; date?: string }[] };

  const base = {
    merchantId: merchant.id,
    store: merchant.name,
    dispute: {
      id: dispute.id,
      paypalDisputeId: dispute.paypalDisputeId,
      reason: dispute.reason,
      stage: dispute.stage,
      status: dispute.status,
      amountCents: dispute.amountCents,
      currency: dispute.currency,
      openedAt: dispute.createdAtPaypal,
      respondBy: dispute.sellerResponseDueAt,
      allowedActions: dispute.allowedActions,
      /** What the buyer told PayPal. */
      buyerStatements: (raw.evidences ?? []).filter((e) => e.source === "SUBMITTED_BY_BUYER" && e.notes).map((e) => ({ at: e.date ?? null, text: e.notes! })),
    },
  };

  if (!dispute.orderId) return { ...base, order: null, caseRecord: null };

  const [order] = await db.select().from(orders).where(eq(orders.id, dispute.orderId));
  const [items, ships, orderRefunds] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    db.select().from(shipments).where(eq(shipments.orderId, order.id)).orderBy(asc(shipments.shippedAt)),
    db.select().from(refunds).where(eq(refunds.orderId, order.id)).orderBy(asc(refunds.createdAt)),
  ]);

  const orderInfo = {
    id: order.id,
    number: order.orderNumber,
    paidAt: order.capturedAt ?? order.createdAt,
    totalCents: order.amountCents,
    refundedCents: order.refundedCents,
    currency: order.currency,
    captureId: order.paypalCaptureId,
    items: items.map((i) => ({ name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
    shipsTo: [order.shippingAddress?.admin_area_2, order.shippingAddress?.admin_area_1, order.shippingAddress?.country_code].filter(Boolean).join(", "),
    shipments: ships.map((s) => ({ carrier: s.carrier, trackingNumber: s.trackingNumber, status: s.status, shippedAt: s.shippedAt, isReplacement: s.isReship })),
    refunds: orderRefunds.filter((r) => r.status === "completed").map((r) => ({ paypalRefundId: r.paypalRefundId, amountCents: r.amountCents, at: r.createdAt })),
  };

  if (!dispute.caseId) return { ...base, order: orderInfo, caseRecord: null };

  const [c] = await db.select().from(cases).where(eq(cases.id, dispute.caseId));
  const [messageRows, actionRows, caseOffers] = await Promise.all([
    db.select().from(messages).where(eq(messages.caseId, c.id)).orderBy(asc(messages.seq)),
    db.select().from(actions).where(eq(actions.caseId, c.id)).orderBy(asc(actions.createdAt)),
    db.select().from(offers).where(eq(offers.caseId, c.id)).orderBy(asc(offers.createdAt)),
  ]);

  const conversation = messageRows
    .filter((m) => m.role === "buyer" || m.role === "agent")
    .map((m) => ({ at: m.createdAt, from: m.role === "buyer" ? ("buyer" as const) : ("store" as const), text: textOf(m.messageJson as ModelMessage) }))
    .filter((m) => m.text);

  return {
    ...base,
    order: orderInfo,
    caseRecord: {
      openedAt: c.openedAt,
      /** The buyer contacted the store (through FirstReply) before going to PayPal. */
      contactedStoreFirst: c.openedAt < dispute.createdAtPaypal,
      issueType: c.issueType,
      status: c.status,
      conversation,
      timeline: actionRows
        .filter((a) => !a.tool.startsWith("dispute_"))
        .map((a) => ({ at: a.createdAt, actor: a.actor, ...describeAction(a) })),
      offers: caseOffers.map((o) => ({ type: o.type, amountCents: o.amountCents, status: o.status, offeredAt: o.offeredAt, answeredAt: o.answeredAt })),
    },
  };
}

/** A compact plain-text version for the model's context. */
export function recordAsText(r: DisputeRecord): string {
  const d = (x: Date | string | null | undefined) => (x ? new Date(x).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
  const $ = (cents: number | null | undefined) => (cents == null ? "—" : `$${(cents / 100).toFixed(2)}`);
  const lines = [
    `STORE: ${r.store}`,
    `DISPUTE ${r.dispute.paypalDisputeId}: reason ${r.dispute.reason}, stage ${r.dispute.stage}, status ${r.dispute.status}, amount ${$(r.dispute.amountCents)}, opened ${d(r.dispute.openedAt)}, respond by ${d(r.dispute.respondBy)}.`,
    `PayPal currently allows the seller to: ${r.dispute.allowedActions.join(", ") || "nothing (PayPal is reviewing)"}.`,
    ...r.dispute.buyerStatements.map((s) => `Buyer told PayPal (${d(s.at)}): "${s.text}"`),
  ];
  if (!r.order) return [...lines, "ORDER: no matching order in this store's records."].join("\n");
  const o = r.order;
  lines.push(
    `ORDER ${o.number}: paid ${d(o.paidAt)}, total ${$(o.totalCents)}, refunded so far ${$(o.refundedCents)}, ships to ${o.shipsTo || "—"}, PayPal capture ${o.captureId ?? "—"}.`,
    `Items: ${o.items.map((i) => `${i.name} × ${i.quantity} @ ${$(i.unitPriceCents)}`).join("; ")}.`,
    ...(o.shipments.length
      ? o.shipments.map((s) => `Shipment${s.isReplacement ? " (replacement)" : ""}: ${s.carrier} ${s.trackingNumber}, shipped ${d(s.shippedAt)}, latest tracking status: ${s.status}.`)
      : ["Shipment: none on file (never shipped)."]),
    ...o.refunds.map((x) => `Refund ${x.paypalRefundId}: ${$(x.amountCents)} on ${d(x.at)}.`),
  );
  if (!r.caseRecord) return [...lines, "CASE: the buyer never contacted the store before disputing."].join("\n");
  const c = r.caseRecord;
  lines.push(
    `CASE opened ${d(c.openedAt)} (${c.contactedStoreFirst ? "BEFORE" : "after"} the dispute), issue ${c.issueType}, status ${c.status}.`,
    "Offers:",
    ...(c.offers.length ? c.offers.map((x) => `- ${x.type} ${$(x.amountCents)}: ${x.status} (offered ${d(x.offeredAt)}, answered ${d(x.answeredAt)})`) : ["- none"]),
    "What the store's agent did (audit log):",
    ...c.timeline.map((t) => `- ${d(t.at)} [${t.actor}] ${t.title}${t.detail ? ` — ${t.detail}` : ""}${t.reasons.length ? ` (${t.reasons.join(" ")})` : ""}`),
    "Conversation:",
    ...c.conversation.map((m) => `- ${d(m.at)} ${m.from}: ${m.text}`),
  );
  return lines.join("\n");
}
