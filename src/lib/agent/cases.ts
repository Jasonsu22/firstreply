/**
 * Cases and conversation memory (PLAN.md §7.7, layers 1–2).
 * The case summary is written by code from facts and offers — never by the LLM.
 */
import type { ModelMessage } from "ai";
import { and, asc, desc, eq, max, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { buyers, caseFacts, cases, messages, offers, orders } from "@/db/schema";
import { formatCents } from "@/lib/money";
import type { IssueType } from "@/lib/policy/engine";
import { recomputeBuyerTier } from "@/lib/policy/context";
import { effectiveTier } from "@/lib/policy/trust";

export type Case = typeof cases.$inferSelect;

const CLOSED: Case["status"][] = ["resolved", "closed"];

export async function getActiveCase(orderId: string): Promise<Case | undefined> {
  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.orderId, orderId), notInArray(cases.status, CLOSED)));
  return row;
}

export async function getLatestCase(orderId: string): Promise<Case | undefined> {
  const [row] = await db.select().from(cases).where(eq(cases.orderId, orderId)).orderBy(desc(cases.openedAt)).limit(1);
  return row;
}

/** Opens a case for an order (or returns the active one). Recomputes the buyer's tier first and snapshots it. */
export async function openCase(orderId: string, issueType: IssueType): Promise<Case> {
  const existing = await getActiveCase(orderId);
  if (existing) return existing;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order?.buyerId) throw new Error("Only paid orders with a known buyer can have a case.");
  await recomputeBuyerTier(order.buyerId);
  const [buyer] = await db.select().from(buyers).where(eq(buyers.id, order.buyerId));

  const [created] = await db
    .insert(cases)
    .values({
      merchantId: order.merchantId,
      orderId,
      buyerId: order.buyerId,
      issueType,
      trustTierAtOpen: effectiveTier(buyer),
    })
    .onConflictDoNothing()
    .returning();
  // Lost a race with a parallel request: use the case it created.
  return created ?? (await getActiveCase(orderId))!;
}

export async function updateCase(caseId: string, patch: Partial<typeof cases.$inferInsert>) {
  const [row] = await db.update(cases).set(patch).where(eq(cases.id, caseId)).returning();
  return row;
}

// ── Conversation (layer 1) ────────────────────────────────────────────────────

const ROLE: Record<ModelMessage["role"], (typeof messages.$inferInsert)["role"]> = {
  user: "buyer",
  assistant: "agent",
  tool: "tool",
  system: "system",
};

function previewOf(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "tool-call") return `[${part.toolName}]`;
      if (part.type === "tool-result") return `[${part.toolName} result]`;
      return `[${part.type}]`;
    })
    .join(" ")
    .slice(0, 2000);
}

export async function loadMessages(caseId: string): Promise<ModelMessage[]> {
  const rows = await db.select().from(messages).where(eq(messages.caseId, caseId)).orderBy(asc(messages.seq));
  return rows.map((r) => r.messageJson as ModelMessage);
}

export async function appendMessages(caseId: string, newMessages: ModelMessage[]) {
  if (newMessages.length === 0) return;
  const [{ last }] = await db.select({ last: max(messages.seq) }).from(messages).where(eq(messages.caseId, caseId));
  let seq = last ?? 0;
  await db.insert(messages).values(
    newMessages.map((m) => ({
      caseId,
      seq: ++seq,
      role: ROLE[m.role],
      messageJson: m,
      textPreview: previewOf(m),
    })),
  );
}

// ── Case summary (layer 2), built by code ─────────────────────────────────────

export async function buildCaseSummary(caseId: string): Promise<string> {
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) return "";
  const [facts, caseOffers] = await Promise.all([
    db.select().from(caseFacts).where(eq(caseFacts.caseId, caseId)).orderBy(desc(caseFacts.observedAt)),
    db.select().from(offers).where(eq(offers.caseId, caseId)).orderBy(asc(offers.createdAt)),
  ]);

  const lines = [`Issue: ${c.issueType.replace(/_/g, " ")}. Case status: ${c.status.replace(/_/g, " ")}.`];
  const latestTracking = facts.find((f) => f.factType === "tracking_status");
  if (latestTracking) {
    const v = latestTracking.value as { status?: string; checked_at?: string };
    lines.push(`Last tracking check: ${v.status} (checked ${v.checked_at ?? latestTracking.observedAt.toISOString()}).`);
  }
  for (const o of caseOffers) {
    const amount = o.amountCents ? ` ${formatCents(o.amountCents)}` : "";
    lines.push(`Offer ${o.id}: ${o.type.replace(/_/g, " ")}${amount} — ${o.status.replace(/_/g, " ")}.`);
  }
  for (const f of facts.filter((f) => f.factType === "inconsistency")) {
    lines.push(`Noted inconsistency: ${(f.value as { observation?: string }).observation}`);
  }
  const photo = facts.find((f) => f.factType === "photo_assessment");
  if (photo) {
    const v = photo.value as { severity?: string; matches_listing?: string; summary?: string; suggested_fix?: string };
    lines.push(
      `Photo assessment: severity ${v.severity ?? "unclear"}, matches listing ${v.matches_listing ?? "unclear"}` +
        (v.summary ? ` — ${v.summary}` : "") +
        (v.suggested_fix ? ` (suggested: ${v.suggested_fix.replace(/_/g, " ")})` : "") +
        ".",
    );
  }
  return lines.join("\n");
}
