/** Read model for the console's Disputes grid. */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { buyers, cases, disputes, orders, syncState } from "@/db/schema";

export type DisputeRow = {
  id: string;
  paypalDisputeId: string;
  orderNumber: string | null;
  caseId: string | null;
  buyerEmail: string | null;
  reason: string;
  stage: string;
  status: string;
  amountCents: number;
  currency: string;
  sellerResponseDueAt: string | null;
  outcome: string | null;
  allowedActions: string[];
  /** The buyer talked to FirstReply before disputing — the strongest evidence for the merchant. */
  contactedFirst: boolean;
  openedAt: string;
  updatedAt: string;
};

export async function listDisputes(merchantId: string): Promise<DisputeRow[]> {
  const rows = await db
    .select({
      d: disputes,
      orderNumber: orders.orderNumber,
      buyerEmail: buyers.email,
      caseOpenedAt: cases.openedAt,
    })
    .from(disputes)
    .leftJoin(orders, eq(orders.id, disputes.orderId))
    .leftJoin(buyers, eq(buyers.id, disputes.buyerId))
    .leftJoin(cases, eq(cases.id, disputes.caseId))
    .where(eq(disputes.merchantId, merchantId))
    .orderBy(desc(disputes.createdAtPaypal));

  return rows.map(({ d, orderNumber, buyerEmail, caseOpenedAt }) => ({
    id: d.id,
    paypalDisputeId: d.paypalDisputeId,
    orderNumber,
    caseId: d.caseId,
    buyerEmail: buyerEmail ?? emailFromRaw(d.raw),
    reason: d.reason,
    stage: d.stage,
    status: d.status,
    amountCents: d.amountCents,
    currency: d.currency,
    sellerResponseDueAt: d.sellerResponseDueAt?.toISOString() ?? null,
    outcome: d.outcome,
    allowedActions: d.allowedActions,
    contactedFirst: !!caseOpenedAt && caseOpenedAt < d.createdAtPaypal,
    openedAt: d.createdAtPaypal.toISOString(),
    updatedAt: (d.updatedAtPaypal ?? d.updatedAt).toISOString(),
  }));
}

function emailFromRaw(raw: unknown): string | null {
  const txns = (raw as { disputed_transactions?: { buyer?: { email?: string } }[] } | null)?.disputed_transactions;
  return txns?.find((t) => t.buyer?.email)?.buyer?.email ?? null;
}

export async function lastDisputeCheck(merchantId: string) {
  const [state] = await db
    .select({ lastPolledAt: syncState.lastPolledAt, lastError: syncState.lastError })
    .from(syncState)
    .where(and(eq(syncState.merchantId, merchantId), eq(syncState.kind, "disputes")));
  return state ? { lastPolledAt: state.lastPolledAt?.toISOString() ?? null, lastError: state.lastError } : null;
}

/** Disputes on one case, newest first (for the case page). */
export async function disputesForCase(caseId: string) {
  return db.select().from(disputes).where(eq(disputes.caseId, caseId)).orderBy(desc(disputes.createdAtPaypal));
}
