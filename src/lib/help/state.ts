/** What the buyer's chat window shows: the order, the conversation so far, and any open offer. */
import type { ModelMessage } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvals, merchants, messages, offers, orderItems, orders, shipments } from "@/db/schema";
import { getLatestCase } from "@/lib/agent/cases";
import type { ChatSession } from "./session";

export type ChatBubble = { role: "buyer" | "agent"; text: string };

export type OfferView = { id: string; type: (typeof offers.$inferSelect)["type"]; amountCents: number | null; label: string };

export type ChatState = {
  store: { name: string; slug: string };
  order: {
    orderNumber: string;
    currency: string;
    amountCents: number;
    refundedCents: number;
    paidAt: string;
    items: { name: string; quantity: number }[];
    shipment: { carrier: string; trackingNumber: string; status: string } | null;
  };
  caseStatus: string | null;
  messages: ChatBubble[];
  /** An offer waiting for the buyer's yes or no. */
  offer: OfferView | null;
  /** A fix waiting for the store team, with when they'll reply. */
  pendingApproval: { label: string; dueAt: string } | null;
};

function money(cents: number | null, currency: string) {
  return cents == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function offerLabel(type: OfferView["type"], amountCents: number | null, currency = "USD") {
  switch (type) {
    case "full_refund":
      return `Full refund of ${money(amountCents, currency)}`;
    case "partial_refund":
      return `Partial refund of ${money(amountCents, currency)}`;
    case "reship":
      return "Free replacement, shipped again";
    case "return_then_refund":
      return `Return the item for a refund of ${money(amountCents, currency)}`;
  }
}

function textOf(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/** Buyer and agent text only — tool calls stay hidden. Consecutive agent texts in one turn become one bubble. */
function toBubbles(rows: { role: string; messageJson: unknown }[]): ChatBubble[] {
  const bubbles: ChatBubble[] = [];
  for (const row of rows) {
    if (row.role !== "buyer" && row.role !== "agent") continue;
    const text = textOf(row.messageJson as ModelMessage).trim();
    if (!text) continue;
    const last = bubbles.at(-1);
    if (row.role === "agent" && last?.role === "agent") last.text += `\n\n${text}`;
    else bubbles.push({ role: row.role, text });
  }
  return bubbles;
}

export async function loadChatState(session: ChatSession): Promise<ChatState> {
  const [[order], [merchant], items, [shipment], latestCase] = await Promise.all([
    db.select().from(orders).where(eq(orders.id, session.orderId)),
    db.select().from(merchants).where(eq(merchants.id, session.merchantId)),
    db.select().from(orderItems).where(eq(orderItems.orderId, session.orderId)),
    db.select().from(shipments).where(eq(shipments.orderId, session.orderId)).orderBy(desc(shipments.shippedAt)).limit(1),
    getLatestCase(session.orderId),
  ]);

  // A resolved case from an earlier visit is shown too, so the buyer sees what was agreed.
  let bubbles: ChatBubble[] = [];
  let offer: ChatState["offer"] = null;
  let pendingApproval: ChatState["pendingApproval"] = null;
  if (latestCase) {
    const [rows, openOffers] = await Promise.all([
      db.select({ role: messages.role, messageJson: messages.messageJson }).from(messages).where(eq(messages.caseId, latestCase.id)).orderBy(asc(messages.seq)),
      db
        .select()
        .from(offers)
        .where(and(eq(offers.caseId, latestCase.id), inArray(offers.status, ["offered", "pending_approval"])))
        .orderBy(desc(offers.createdAt))
        .limit(1),
    ]);
    bubbles = toBubbles(rows);
    const open = openOffers[0];
    if (open?.status === "offered") {
      offer = { id: open.id, type: open.type, amountCents: open.amountCents, label: offerLabel(open.type, open.amountCents, order.currency) };
    } else if (open?.status === "pending_approval") {
      const [approval] = await db.select().from(approvals).where(eq(approvals.offerId, open.id));
      pendingApproval = { label: offerLabel(open.type, open.amountCents, order.currency), dueAt: (approval?.dueAt ?? new Date()).toISOString() };
    }
  }

  return {
    store: { name: merchant.name, slug: merchant.slug },
    order: {
      orderNumber: order.orderNumber,
      currency: order.currency,
      amountCents: order.amountCents,
      refundedCents: order.refundedCents,
      paidAt: (order.capturedAt ?? order.createdAt).toISOString(),
      items: items.map((i) => ({ name: i.name, quantity: i.quantity })),
      shipment: shipment ? { carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, status: shipment.status } : null,
    },
    caseStatus: latestCase?.status ?? null,
    messages: bubbles,
    offer,
    pendingApproval,
  };
}
