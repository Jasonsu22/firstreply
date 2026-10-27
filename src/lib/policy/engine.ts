/**
 * Policy engine (PLAN.md §7.4) — the safety core.
 * The LLM *proposes* a fix; this plain code *decides* whether it's allowed, needs the
 * merchant's approval, or is denied. Nothing the buyer or the model says can change a limit.
 *
 * Pure function: the database adapter (./context.ts) builds the context.
 */
import { formatCents } from "@/lib/money";
import type { TrustTier } from "./trust";

export type IssueType = "not_received" | "not_as_described" | "damaged" | "unrecognized_charge" | "cancel" | "other";
export type ProposalType = "full_refund" | "partial_refund" | "reship" | "return_then_refund" | "explain";
export type Decision = "allowed" | "needs_approval" | "denied";

export type Proposal = { type: ProposalType; amountCents?: number };

export type PolicyContext = {
  policy: {
    autoRefundLimitCents: number;
    trustedAutoRefundLimitCents: number;
    reshipAllowed: boolean;
    maxReshipsPerOrder: number;
    notReceivedWaitDays: number;
  };
  issueType: IssueType;
  order: {
    status: "created" | "captured" | "partially_refunded" | "refunded" | "cancelled";
    amountCents: number;
    refundedCents: number;
    /** False for orders with no PayPal capture (e.g. imported or seeded history): PayPal can't refund or track them. */
    paidThroughPayPal?: boolean;
  };
  /** Latest shipment for the order, or null if it hasn't shipped. */
  shipment: { status: "shipped" | "on_hold" | "delivered" | "cancelled" | "lost"; shippedAt: Date } | null;
  reshipCount: number;
  /** A fix already carried out on this order (one resolution per order). */
  priorResolution: "refund" | "reship" | null;
  buyer: { tier: TrustTier; flagged: boolean };
  now: Date;
};

export type ReasonCode =
  | "NO_MONEY_INVOLVED"
  | "ORDER_NOT_PAID"
  | "NOT_A_PAYPAL_PAYMENT"
  | "NOTHING_LEFT_TO_REFUND"
  | "INVALID_AMOUNT"
  | "ALREADY_RESOLVED"
  | "RESHIP_DISABLED"
  | "RESHIP_LIMIT_REACHED"
  | "NOT_SHIPPED_YET"
  | "REFUND_ALREADY_ISSUED"
  | "RESHIP_NOT_APPLICABLE"
  | "TOO_EARLY"
  | "DELIVERED_PER_TRACKING"
  | "UNRECOGNIZED_CHARGE"
  | "CANCEL_AFTER_SHIPPING"
  | "TRUST_TIER"
  | "BUYER_FLAGGED"
  | "OVER_AUTO_LIMIT"
  | "WITHIN_POLICY";

export type Reason = { code: ReasonCode; decision: Decision; message: string };

export type PolicyResult = {
  decision: Decision;
  /** The amount the fix involves (refund amount, or the order value for a reship); null for "explain". */
  amountCents: number | null;
  reasons: Reason[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const SEVERITY: Record<Decision, number> = { allowed: 0, needs_approval: 1, denied: 2 };

export function evaluateProposal(proposal: Proposal, ctx: PolicyContext): PolicyResult {
  if (proposal.type === "explain") {
    return { decision: "allowed", amountCents: null, reasons: [reason("NO_MONEY_INVOLVED", "allowed", "Explaining involves no money.")] };
  }

  const reasons: Reason[] = [];
  const deny = (code: ReasonCode, message: string) => reasons.push(reason(code, "denied", message));
  const ask = (code: ReasonCode, message: string) => reasons.push(reason(code, "needs_approval", message));

  // ── The order must be paid and have money left to give back ────────────────
  if (ctx.order.status === "created" || ctx.order.status === "cancelled") {
    return finish([reason("ORDER_NOT_PAID", "denied", "The order isn't paid, so there's nothing to fix with money.")], null);
  }
  if (ctx.order.paidThroughPayPal === false) {
    return finish([reason("NOT_A_PAYPAL_PAYMENT", "denied", "This order has no PayPal payment on file, so a refund or replacement can't go through PayPal.")], null);
  }
  const refundable = ctx.order.amountCents - ctx.order.refundedCents;
  const amountCents = resolveAmount(proposal, refundable);
  if (refundable <= 0) {
    return finish([reason("NOTHING_LEFT_TO_REFUND", "denied", "The order has already been fully refunded.")], 0);
  }
  if (amountCents === null) {
    return finish(
      [reason("INVALID_AMOUNT", "denied", `A partial refund must be between $0.01 and ${formatCents(refundable - 1)}.`)],
      proposal.amountCents ?? null,
    );
  }

  // ── One resolution per order; never refund and reship the same order ───────
  if (ctx.priorResolution) {
    deny("ALREADY_RESOLVED", `This order was already resolved with a ${ctx.priorResolution}.`);
  }

  if (proposal.type === "reship") {
    if (!ctx.policy.reshipAllowed) deny("RESHIP_DISABLED", "The store doesn't offer reships.");
    if (ctx.reshipCount >= ctx.policy.maxReshipsPerOrder) deny("RESHIP_LIMIT_REACHED", `Already reshipped ${ctx.reshipCount} time(s).`);
    if (!ctx.shipment) deny("NOT_SHIPPED_YET", "The order hasn't shipped yet, so there's nothing to reship.");
    if (ctx.order.refundedCents > 0) deny("REFUND_ALREADY_ISSUED", "Part of this order was refunded; a reship would pay twice.");
    if (ctx.issueType === "unrecognized_charge" || ctx.issueType === "cancel") {
      deny("RESHIP_NOT_APPLICABLE", "A reship doesn't fit this kind of problem.");
    }
  }

  // ── What the problem itself allows ─────────────────────────────────────────
  if (ctx.issueType === "not_received" && ctx.shipment) {
    const { status, shippedAt } = ctx.shipment;
    const windowEnds = new Date(shippedAt.getTime() + ctx.policy.notReceivedWaitDays * DAY_MS);
    if (status === "delivered") {
      ask("DELIVERED_PER_TRACKING", "Tracking shows the parcel was delivered; the store should check before any refund or reship.");
    } else if (status === "shipped" && ctx.now < windowEnds) {
      deny("TOO_EARLY", `The parcel is still in its normal delivery window (until ${dateFormat.format(windowEnds)}); explain and check back then.`);
    }
    // on_hold, lost and cancelled count as not received straight away.
  }
  if (ctx.issueType === "unrecognized_charge") {
    ask("UNRECOGNIZED_CHARGE", "Unrecognized charges should be explained first; refunding one needs the store's review.");
  }
  if (ctx.issueType === "cancel" && ctx.shipment && proposal.type !== "return_then_refund") {
    ask("CANCEL_AFTER_SHIPPING", "The order already shipped; a cancellation normally needs the item returned first.");
  }

  // ── Who is asking ──────────────────────────────────────────────────────────
  if (ctx.buyer.flagged) {
    ask("BUYER_FLAGGED", "The store flagged this buyer for manual review of any money fix.");
  }
  if (ctx.buyer.tier === "watch" || ctx.buyer.tier === "high_risk") {
    ask("TRUST_TIER", `Buyer is on ${ctx.buyer.tier === "watch" ? "Watch" : "High risk"}: no automatic money fixes.`);
  }

  // ── How much ───────────────────────────────────────────────────────────────
  const limit = ctx.buyer.tier === "trusted" ? ctx.policy.trustedAutoRefundLimitCents : ctx.policy.autoRefundLimitCents;
  if (amountCents > limit) {
    ask("OVER_AUTO_LIMIT", `${formatCents(amountCents)} is over the automatic limit of ${formatCents(limit)}.`);
  }

  return finish(reasons, amountCents);
}

/** Works out the money involved, or null if a partial refund amount is invalid. */
function resolveAmount(proposal: Proposal, refundable: number): number | null {
  switch (proposal.type) {
    case "partial_refund": {
      const amount = proposal.amountCents;
      if (amount === undefined || !Number.isInteger(amount) || amount <= 0 || amount >= refundable) return null;
      return amount;
    }
    case "full_refund":
    case "return_then_refund":
    case "reship": // a reship costs the merchant roughly the order's value
      return refundable;
    default:
      return refundable;
  }
}

function reason(code: ReasonCode, decision: Decision, message: string): Reason {
  return { code, decision, message };
}

function finish(reasons: Reason[], amountCents: number | null): PolicyResult {
  if (reasons.length === 0) {
    return { decision: "allowed", amountCents, reasons: [reason("WITHIN_POLICY", "allowed", "Within the store's automatic limits.")] };
  }
  const decision = reasons.reduce<Decision>((worst, r) => (SEVERITY[r.decision] > SEVERITY[worst] ? r.decision : worst), "allowed");
  // Show the reasons that decided the outcome first.
  const ordered = [...reasons].sort((a, b) => SEVERITY[b.decision] - SEVERITY[a.decision]);
  return { decision, amountCents, reasons: ordered };
}
