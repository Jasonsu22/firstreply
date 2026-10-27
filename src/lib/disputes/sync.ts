/**
 * Dispute watcher (PLAN.md §6, day 10). Pulls disputes from PayPal, matches each to its order and FirstReply
 * case, and records every change in the case timeline. Runs from three places:
 *   - a poller every minute while the server is up (src/instrumentation.ts)
 *   - PayPal webhooks (/api/webhooks/paypal) for near-instant updates
 *   - "Check PayPal now" / "Add by dispute ID" in the console (the list API can lag a few minutes; get-by-ID doesn't)
 */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { buyers, cases, disputes, orders, syncState } from "@/db/schema";
import { logAction } from "@/lib/agent/audit";
import { getActiveCase, updateCase } from "@/lib/agent/cases";
import { paypalRequest } from "@/lib/paypal/client";
import { recomputeBuyerTier } from "@/lib/policy/context";
import { effectiveTier } from "@/lib/policy/trust";
import { issueTypeFor, mapDispute, orderKeys, type PayPalDispute } from "./map";

/** A case this recent is "the same problem" as a new dispute on its order. */
const LINK_WINDOW_DAYS = 120;
const LIST_OVERLAP_MS = 15 * 60_000;

type Dispute = typeof disputes.$inferSelect;
export type UpsertResult = { dispute: Dispute; isNew: boolean; changed: boolean };

export async function fetchDispute(paypalDisputeId: string): Promise<PayPalDispute> {
  if (!/^PP-[A-Z0-9-]{4,40}$/i.test(paypalDisputeId)) throw new Error("That doesn't look like a PayPal dispute ID (PP-…).");
  return (await paypalRequest(`/v1/customer/disputes/${encodeURIComponent(paypalDisputeId)}`)) as PayPalDispute;
}

/**
 * The disputed order, by PayPal capture ID only: it's unique to a real payment, and every paid order has one.
 * (Not by order number — two databases sharing one sandbox account reuse numbers, and unpaid checkouts can't be disputed.)
 */
async function findOrder(merchantId: string, d: PayPalDispute) {
  const { captureIds } = orderKeys(d);
  if (!captureIds.length) return undefined;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.merchantId, merchantId), inArray(orders.paypalCaptureId, captureIds)));
  return order;
}

/** The case this dispute belongs to: the active one, a recent one (re-opened as disputed), or a new one. */
async function caseFor(order: typeof orders.$inferSelect, reason: Dispute["reason"], disputedAt: Date) {
  const active = await getActiveCase(order.id);
  if (active) return active;
  if (!order.buyerId) return undefined;

  const [recent] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.orderId, order.id), gt(cases.openedAt, new Date(Date.now() - LINK_WINDOW_DAYS * 864e5))))
    .orderBy(desc(cases.openedAt))
    .limit(1);
  if (recent) return recent;

  const [buyer] = await db.select().from(buyers).where(eq(buyers.id, order.buyerId));
  const [created] = await db
    .insert(cases)
    .values({
      merchantId: order.merchantId,
      orderId: order.id,
      buyerId: order.buyerId,
      issueType: issueTypeFor(reason),
      status: "disputed",
      trustTierAtOpen: buyer ? effectiveTier(buyer) : "normal",
      summary: "Opened by a PayPal dispute — the buyer didn't contact the store first.",
      disputedAt,
    })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getActiveCase(order.id));
}

/** Saves one PayPal dispute, links it to its order and case, and logs what changed. */
export async function upsertDispute(merchantId: string, d: PayPalDispute, source: "poll" | "webhook" | "manual"): Promise<UpsertResult> {
  const mapped = mapDispute(d);
  const [existing] = await db.select().from(disputes).where(eq(disputes.paypalDisputeId, mapped.paypalDisputeId));

  // Re-matched on every sync, so a wrong or missing link corrects itself.
  const order = await findOrder(merchantId, d);
  const keepCase = existing?.caseId && existing.orderId === order?.id;
  const caseRow = keepCase
    ? (await db.select().from(cases).where(eq(cases.id, existing.caseId!)))[0]
    : order
      ? await caseFor(order, mapped.reason, mapped.createdAtPaypal)
      : undefined;

  const values = { ...mapped, merchantId, orderId: order?.id ?? null, caseId: caseRow?.id ?? null, buyerId: order?.buyerId ?? null, updatedAt: new Date() };
  const [dispute] = await db.insert(disputes).values(values).onConflictDoUpdate({ target: disputes.paypalDisputeId, set: values }).returning();

  const isNew = !existing;
  const changed = isNew || existing.status !== dispute.status || existing.stage !== dispute.stage || existing.outcome !== dispute.outcome;

  if (caseRow && changed) {
    const closed = dispute.outcome != null;
    await updateCase(caseRow.id, { status: closed ? "closed" : "disputed", disputedAt: caseRow.disputedAt ?? dispute.createdAtPaypal });
    await logAction({
      merchantId,
      caseId: caseRow.id,
      actor: "worker",
      tool: isNew ? "dispute_opened" : "dispute_updated",
      args: { dispute_id: dispute.paypalDisputeId, source },
      result: {
        reason: dispute.reason,
        stage: dispute.stage,
        status: dispute.status,
        amount_cents: dispute.amountCents,
        seller_response_due_at: dispute.sellerResponseDueAt,
        outcome: dispute.outcome,
        allowed_actions: dispute.allowedActions,
      },
      status: "ok",
    });
    if (order?.buyerId) await recomputeBuyerTier(order.buyerId);
  }
  return { dispute, isNew, changed };
}

type ListResponse = { items?: { dispute_id: string; update_time?: string }[] };

let running: Promise<SyncSummary> | null = null;
export type SyncSummary = { checked: number; created: number; updated: number; unmatched: number; errors: string[] };

/** One polling pass: list recent disputes and fetch the ones that are new or changed. Never runs twice at once. */
export function syncDisputes(merchantId: string, source: "poll" | "manual" = "poll"): Promise<SyncSummary> {
  running ??= runSync(merchantId, source).finally(() => {
    running = null;
  });
  return running;
}

async function runSync(merchantId: string, source: "poll" | "manual"): Promise<SyncSummary> {
  const summary: SyncSummary = { checked: 0, created: 0, updated: 0, unmatched: 0, errors: [] };
  const startedAt = new Date();
  const [state] = await db.select().from(syncState).where(and(eq(syncState.merchantId, merchantId), eq(syncState.kind, "disputes")));

  try {
    const params = new URLSearchParams({ page_size: "50" });
    if (state?.lastPolledAt) params.set("update_time_after", new Date(state.lastPolledAt.getTime() - LIST_OVERLAP_MS).toISOString());
    const list = (await paypalRequest(`/v1/customer/disputes?${params}`)) as ListResponse;
    const items = list.items ?? [];
    summary.checked = items.length;

    const known = items.length
      ? await db
          .select({ id: disputes.paypalDisputeId, updatedAtPaypal: disputes.updatedAtPaypal })
          .from(disputes)
          .where(inArray(disputes.paypalDisputeId, items.map((i) => i.dispute_id)))
      : [];
    const seen = new Map(known.map((k) => [k.id, k.updatedAtPaypal?.getTime()]));

    for (const item of items) {
      if (item.update_time && seen.get(item.dispute_id) === new Date(item.update_time).getTime()) continue;
      try {
        const result = await upsertDispute(merchantId, await fetchDispute(item.dispute_id), source);
        if (result.isNew) summary.created++;
        else if (result.changed) summary.updated++;
        if (!result.dispute.orderId) summary.unmatched++;
      } catch (err) {
        summary.errors.push(`${item.dispute_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
  }

  const bookmark = { lastPolledAt: summary.errors.length ? (state?.lastPolledAt ?? null) : startedAt, lastError: summary.errors[0] ?? null };
  await db
    .insert(syncState)
    .values({ merchantId, kind: "disputes", ...bookmark })
    .onConflictDoUpdate({ target: [syncState.merchantId, syncState.kind], set: bookmark });
  return summary;
}
