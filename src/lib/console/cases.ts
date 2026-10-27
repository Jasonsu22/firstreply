/** Read models for the merchant console: the cases grid and one case's full record. Always scoped to one merchant. */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { actions, approvals, buyers, caseFacts, cases, messages, offers, orderItems, orders, refunds, shipments } from "@/db/schema";
import { buildCaseSummary } from "@/lib/agent/cases";
import { toBubbles } from "@/lib/help/state";
import { effectiveTier } from "@/lib/policy/trust";
import { listApprovals } from "./approvals";
import { describeAction, type TimelineEntry } from "./timeline";

export type CaseRow = {
  id: string;
  orderNumber: string;
  buyerEmail: string;
  buyerName: string | null;
  buyerTier: string;
  tierAtOpen: string;
  issueType: string;
  status: string;
  resolutionType: string | null;
  resolutionAmountCents: number | null;
  orderAmountCents: number;
  currency: string;
  /** Last policy decision the agent got for this case. */
  lastDecision: string | null;
  pendingApproval: boolean;
  /** The approval waiting on the merchant, for the grid's Approve / Reject buttons. */
  approval: { id: string; label: string; atStakeCents: number; offerType: string } | null;
  /** Messages the buyer sent. */
  messageCount: number;
  openedAt: string;
  resolvedAt: string | null;
  lastActivityAt: string;
  /** Minutes from open to resolved, for resolved cases. */
  minutesToResolve: number | null;
};

export async function listCases(merchantId: string): Promise<CaseRow[]> {
  const rows = await db
    .select({
      id: cases.id,
      orderNumber: orders.orderNumber,
      buyerEmail: buyers.email,
      buyerName: buyers.name,
      trustTier: buyers.trustTier,
      manualTier: buyers.manualTier,
      tierAtOpen: cases.trustTierAtOpen,
      issueType: cases.issueType,
      status: cases.status,
      resolutionType: cases.resolutionType,
      resolutionAmountCents: cases.resolutionAmountCents,
      orderAmountCents: orders.amountCents,
      currency: orders.currency,
      openedAt: cases.openedAt,
      resolvedAt: cases.resolvedAt,
      lastDecision: sql<string | null>`(SELECT a.policy_decision FROM ${actions} a WHERE a.case_id = ${cases.id} AND a.policy_decision IS NOT NULL ORDER BY a.created_at DESC LIMIT 1)`,
      pendingApproval: sql<boolean>`EXISTS (SELECT 1 FROM ${approvals} p WHERE p.case_id = ${cases.id} AND p.status = 'pending')`,
      messageCount: sql<number>`(SELECT count(*)::int FROM ${messages} m WHERE m.case_id = ${cases.id} AND m.role = 'buyer')`,
      lastActivityAt: sql<Date>`GREATEST(${cases.openedAt}, (SELECT max(a.created_at) FROM ${actions} a WHERE a.case_id = ${cases.id}), (SELECT max(m.created_at) FROM ${messages} m WHERE m.case_id = ${cases.id}))`,
    })
    .from(cases)
    .innerJoin(orders, eq(orders.id, cases.orderId))
    .innerJoin(buyers, eq(buyers.id, cases.buyerId))
    .where(eq(cases.merchantId, merchantId))
    .orderBy(desc(cases.openedAt));

  const pending = new Map((await listApprovals(merchantId, "pending")).map((a) => [a.caseId, a]));
  return rows.map(({ trustTier, manualTier, openedAt, resolvedAt, lastActivityAt, ...r }) => ({
    ...r,
    approval: pending.has(r.id) ? (({ id, offerLabel, atStakeCents, offerType }) => ({ id, label: offerLabel, atStakeCents, offerType }))(pending.get(r.id)!) : null,
    buyerTier: effectiveTier({ trustTier, manualTier }),
    openedAt: openedAt.toISOString(),
    resolvedAt: resolvedAt?.toISOString() ?? null,
    lastActivityAt: new Date(lastActivityAt).toISOString(),
    minutesToResolve: resolvedAt ? Math.max(0, Math.round((resolvedAt.getTime() - openedAt.getTime()) / 60_000)) : null,
  }));
}

export type TimelineItem = TimelineEntry & { id: string; at: string; actor: string; tool: string; agentReason: string | null; raw: { arguments: unknown; result: unknown } };

/** Everything about one case: order, buyer, conversation, audit timeline, offers and refunds. */
export async function getCaseDetail(merchantId: string, caseId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) return undefined;
  const [c] = await db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.merchantId, merchantId)));
  if (!c) return undefined;

  const [[order], [buyer], items, ships, messageRows, actionRows, caseOffers, caseRefunds, facts, caseApprovals, summary] = await Promise.all([
    db.select().from(orders).where(eq(orders.id, c.orderId)),
    db.select().from(buyers).where(eq(buyers.id, c.buyerId)),
    db.select().from(orderItems).where(eq(orderItems.orderId, c.orderId)),
    db.select().from(shipments).where(eq(shipments.orderId, c.orderId)).orderBy(asc(shipments.shippedAt)),
    db.select({ role: messages.role, messageJson: messages.messageJson }).from(messages).where(eq(messages.caseId, caseId)).orderBy(asc(messages.seq)),
    db.select().from(actions).where(eq(actions.caseId, caseId)).orderBy(asc(actions.createdAt)),
    db.select().from(offers).where(eq(offers.caseId, caseId)).orderBy(asc(offers.createdAt)),
    db.select().from(refunds).where(eq(refunds.orderId, c.orderId)).orderBy(asc(refunds.createdAt)),
    db.select().from(caseFacts).where(eq(caseFacts.caseId, caseId)).orderBy(asc(caseFacts.observedAt)),
    db.select().from(approvals).where(eq(approvals.caseId, caseId)).orderBy(asc(approvals.createdAt)),
    buildCaseSummary(caseId),
  ]);

  const timeline: TimelineItem[] = actionRows.map((a) => ({
    ...describeAction(a),
    id: a.id,
    at: a.createdAt.toISOString(),
    actor: a.actor,
    tool: a.tool,
    agentReason: a.agentReason,
    raw: { arguments: a.arguments, result: a.result },
  }));

  return {
    case: { ...c, openedAt: c.openedAt.toISOString(), resolvedAt: c.resolvedAt?.toISOString() ?? null },
    summary,
    order: { ...order, items, shipments: ships },
    buyer: { ...buyer, tier: effectiveTier(buyer) },
    conversation: toBubbles(messageRows),
    timeline,
    offers: caseOffers,
    refunds: caseRefunds,
    facts,
    approvals: caseApprovals,
  };
}

export type CaseDetail = NonNullable<Awaited<ReturnType<typeof getCaseDetail>>>;
