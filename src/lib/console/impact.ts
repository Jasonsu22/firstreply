/**
 * Impact dashboard numbers (PLAN.md §9, docs/DATABASE.md).
 * Pure compute is unit-tested; loadImpact pulls live rows for one merchant.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { approvals, cases, chatSessions, disputes, orders } from "@/db/schema";

/** Industry multiplier for cost of a dispute vs resolving before one is filed (PLAN.md). */
export const DISPUTE_COST_MULTIPLIER = 5.13;

export type ImpactRoute = "auto" | "approved" | "escalated" | "other";

export type ImpactCaseInput = {
  id: string;
  status: string;
  issueType: string;
  trustTierAtOpen: string;
  orderAmountCents: number;
  openedAt: Date;
  resolvedAt: Date | null;
  hasDispute: boolean;
  door: string | null;
  /** How the case was handled: auto policy, merchant approval, or human escalate. */
  route: ImpactRoute;
};

export type CountRow = { key: string; count: number; label: string };

export type ImpactStats = {
  casesTotal: number;
  disputesPrevented: number;
  /** Sum of prevented cases' order amounts (cents). */
  preventedOrderCents: number;
  /** preventedOrderCents × DISPUTE_COST_MULTIPLIER, rounded. */
  moneySavedCents: number;
  /** Average minutes from open → resolve for resolved cases with a resolvedAt. */
  avgMinutesToResolve: number | null;
  resolvedCount: number;
  openCount: number;
  disputedCount: number;
  byRoute: CountRow[];
  byIssue: CountRow[];
  byTier: CountRow[];
  byDoor: CountRow[];
};

const ISSUE_LABEL: Record<string, string> = {
  not_received: "Not received",
  not_as_described: "Not as described",
  damaged: "Damaged",
  unrecognized_charge: "Unrecognized charge",
  cancel: "Cancel",
  other: "Other",
};

const TIER_LABEL: Record<string, string> = {
  trusted: "Trusted",
  normal: "Normal",
  watch: "Watch",
  high_risk: "High risk",
};

const DOOR_LABEL: Record<string, string> = {
  widget: "Help widget",
  email_link: "Email / order link",
  statement: "Statement link",
  hosted_page: "Hosted help page",
  dispute_inquiry: "Dispute inquiry",
  seeded: "Seeded history",
};

const ROUTE_LABEL: Record<string, string> = {
  auto: "Handled automatically",
  approved: "Merchant approved",
  escalated: "Escalated to human",
  other: "In progress / other",
};

function tally(keys: string[], labels: Record<string, string>): CountRow[] {
  const map = new Map<string, number>();
  for (const k of keys) map.set(k, (map.get(k) ?? 0) + 1);
  return [...map.entries()]
    .map(([key, count]) => ({ key, count, label: labels[key] ?? key }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** A prevented dispute: the case was resolved (or closed) and never linked to a PayPal dispute. */
export function isPrevented(c: Pick<ImpactCaseInput, "status" | "hasDispute">) {
  return (c.status === "resolved" || c.status === "closed") && !c.hasDispute;
}

export function computeImpact(rows: ImpactCaseInput[]): ImpactStats {
  const prevented = rows.filter(isPrevented);
  const preventedOrderCents = prevented.reduce((sum, c) => sum + c.orderAmountCents, 0);
  const resolvedWithTime = rows.filter((c) => c.resolvedAt && (c.status === "resolved" || c.status === "closed"));
  const avgMinutesToResolve =
    resolvedWithTime.length === 0
      ? null
      : Math.round(
          resolvedWithTime.reduce((sum, c) => sum + (c.resolvedAt!.getTime() - c.openedAt.getTime()) / 60_000, 0) /
            resolvedWithTime.length,
        );

  return {
    casesTotal: rows.length,
    disputesPrevented: prevented.length,
    preventedOrderCents,
    moneySavedCents: Math.round(preventedOrderCents * DISPUTE_COST_MULTIPLIER),
    avgMinutesToResolve,
    resolvedCount: rows.filter((c) => c.status === "resolved" || c.status === "closed").length,
    openCount: rows.filter((c) => !["resolved", "closed", "disputed"].includes(c.status)).length,
    disputedCount: rows.filter((c) => c.status === "disputed" || c.hasDispute).length,
    byRoute: tally(
      rows.filter((c) => c.route !== "other").map((c) => c.route),
      ROUTE_LABEL,
    ),
    byIssue: tally(
      rows.map((c) => c.issueType),
      ISSUE_LABEL,
    ),
    byTier: tally(
      rows.map((c) => c.trustTierAtOpen),
      TIER_LABEL,
    ),
    byDoor: tally(
      rows.map((c) => c.door ?? "seeded"),
      DOOR_LABEL,
    ),
  };
}

export function classifyRoute(input: {
  status: string;
  hadApprovedApproval: boolean;
}): ImpactRoute {
  if (input.status === "escalated") return "escalated";
  if (input.hadApprovedApproval) return "approved";
  if (input.status === "resolved" || input.status === "closed") return "auto";
  return "other";
}

/** Load every case for a merchant and compute the dashboard. */
export async function loadImpact(merchantId: string): Promise<ImpactStats> {
  const caseRows = await db
    .select({
      id: cases.id,
      status: cases.status,
      issueType: cases.issueType,
      trustTierAtOpen: cases.trustTierAtOpen,
      openedAt: cases.openedAt,
      resolvedAt: cases.resolvedAt,
      orderAmountCents: orders.amountCents,
    })
    .from(cases)
    .innerJoin(orders, eq(orders.id, cases.orderId))
    .where(eq(cases.merchantId, merchantId));

  if (caseRows.length === 0) return computeImpact([]);

  const caseIds = caseRows.map((c) => c.id);

  const disputeRows = await db
    .select({ caseId: disputes.caseId })
    .from(disputes)
    .where(and(eq(disputes.merchantId, merchantId), isNotNull(disputes.caseId), inArray(disputes.caseId, caseIds)));
  const disputedCaseIds = new Set(disputeRows.map((d) => d.caseId!).filter(Boolean));

  const approvedRows = await db
    .select({ caseId: approvals.caseId })
    .from(approvals)
    .where(and(inArray(approvals.caseId, caseIds), eq(approvals.status, "approved")));
  const approvedCaseIds = new Set(approvedRows.map((a) => a.caseId));

  // Earliest chat session door per case (a case can be reopened from several doors).
  const sessions = await db
    .select({
      caseId: chatSessions.caseId,
      door: chatSessions.door,
      createdAt: chatSessions.createdAt,
    })
    .from(chatSessions)
    .where(and(eq(chatSessions.merchantId, merchantId), isNotNull(chatSessions.caseId), inArray(chatSessions.caseId, caseIds)))
    .orderBy(chatSessions.createdAt);
  const doorByCase = new Map<string, string>();
  for (const s of sessions) {
    if (s.caseId && !doorByCase.has(s.caseId)) doorByCase.set(s.caseId, s.door);
  }

  const inputs: ImpactCaseInput[] = caseRows.map((c) => ({
    id: c.id,
    status: c.status,
    issueType: c.issueType,
    trustTierAtOpen: c.trustTierAtOpen,
    orderAmountCents: c.orderAmountCents,
    openedAt: c.openedAt,
    resolvedAt: c.resolvedAt,
    hasDispute: disputedCaseIds.has(c.id),
    door: doorByCase.get(c.id) ?? null,
    route: classifyRoute({ status: c.status, hadApprovedApproval: approvedCaseIds.has(c.id) }),
  }));

  return computeImpact(inputs);
}

export function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 48) return m === 0 ? `${h}h` : `${h}h ${m}m`;
  const d = Math.round(minutes / (60 * 24));
  return `${d} day${d === 1 ? "" : "s"}`;
}
