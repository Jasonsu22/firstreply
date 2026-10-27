/**
 * Turns audit-log rows (`actions`) into plain-language timeline entries for the merchant console.
 * Pure, so it's unit-tested; the raw arguments and result stay one click away in the UI.
 */
import { disputeStageLabel } from "@/lib/disputes/map";
import { formatCents } from "@/lib/money";

export type ActionRow = {
  tool: string;
  actor: string;
  status: "ok" | "error" | "blocked_by_policy";
  arguments: unknown;
  result: unknown;
  policyDecision: "allowed" | "needs_approval" | "denied" | null;
  policyReasons: string[] | null;
  agentReason: string | null;
  paypalDebugId: string | null;
};

export type Tone = "neutral" | "check" | "allowed" | "approval" | "denied" | "money" | "error";
export type TimelineEntry = { title: string; detail?: string; tone: Tone; reasons: string[]; paypalRef?: string };

const words = (s: string) => s.replace(/_/g, " ");
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

const OFFER_LABEL: Record<string, string> = {
  full_refund: "full refund",
  partial_refund: "partial refund",
  reship: "replacement (reship)",
  return_then_refund: "return, then refund",
};

export function describeAction(row: ActionRow): TimelineEntry {
  const args = obj(row.arguments);
  const result = obj(row.result);
  const reasons = row.policyReasons ?? [];

  if (row.status === "error") {
    return {
      title: `${words(row.tool)} failed`,
      detail: typeof result.error === "string" ? result.error : undefined,
      tone: "error",
      reasons,
      paypalRef: row.paypalDebugId ? `debug id ${row.paypalDebugId}` : undefined,
    };
  }

  switch (row.tool) {
    case "classify_issue":
      return { title: `Classified as “${words(String(result.issue_type ?? "other"))}”`, detail: result.summary as string | undefined, tone: "neutral", reasons };
    case "get_order": {
      const total = result.total ? ` · ${result.total}` : "";
      return { title: "Looked up the order in PayPal", detail: `Payment ${String(result.payment_status ?? "unknown").toLowerCase()}${total}`, tone: "check", reasons };
    }
    case "get_shipment_status": {
      if (result.shipped === false) return { title: "Checked shipping", detail: "Not shipped yet", tone: "check", reasons };
      const tracking = result.tracking_number ? `${result.carrier ?? ""} ${result.tracking_number}`.trim() : undefined;
      return { title: `Checked tracking: ${words(String(result.status ?? "unknown"))}`, detail: tracking, tone: "check", reasons };
    }
    case "update_issue_type":
      return { title: `Changed issue to “${words(String(args.issue_type ?? ""))}”`, tone: "neutral", reasons };
    case "propose_resolution": {
      const type = OFFER_LABEL[String(args.type)] ?? words(String(args.type ?? "fix"));
      const amount = typeof result.amountCents === "number" && result.amountCents > 0 ? ` of ${formatCents(result.amountCents)}` : "";
      const decision = row.policyDecision ?? (result.decision as TimelineEntry["tone"] | undefined);
      if (decision === "allowed") return { title: `Policy allowed a ${type}${amount}`, detail: "Offered to the buyer", tone: "allowed", reasons };
      if (decision === "needs_approval") return { title: `Policy sent a ${type}${amount} for approval`, detail: "Waiting for the store team", tone: "approval", reasons };
      return { title: `Policy refused a ${type}`, tone: "denied", reasons };
    }
    case "accept_offer":
      if (row.status === "blocked_by_policy") return { title: "Buyer accepted, but the policy re-check refused it", tone: "denied", reasons };
      return { title: "Buyer accepted the offer", detail: result.return_requested ? "Return requested before refund" : undefined, tone: "allowed", reasons };
    case "issue_refund": {
      const paypal = obj(result.paypal);
      const amount = typeof args.amount_cents === "number" ? formatCents(args.amount_cents) : "";
      return { title: `Refunded ${amount} through PayPal`.replace("  ", " "), detail: paypal.status ? `PayPal status ${String(paypal.status).toLowerCase()}` : undefined, tone: "money", reasons, paypalRef: paypal.id ? `refund ${paypal.id}` : undefined };
    }
    case "create_reship":
      return { title: "Created a replacement shipment", detail: result.trackingNumber ? `${result.carrier ?? ""} ${result.trackingNumber}`.trim() : undefined, tone: "money", reasons };
    case "decline_offer":
      return { title: "Buyer declined the offer", tone: "neutral", reasons };
    case "record_inconsistency":
      return { title: "Noted an inconsistency", detail: args.observation as string | undefined, tone: "approval", reasons };
    case "escalate_to_human":
      return { title: "Escalated to the store team", tone: "approval", reasons };
    case "approve_offer":
      if (row.status === "blocked_by_policy") return { title: "Approval blocked by a hard limit", tone: "denied", reasons, detail: row.agentReason ?? undefined };
      return { title: `Approved by ${String(args.by ?? "the store team")}`, detail: row.agentReason ?? undefined, tone: "allowed", reasons: [] };
    case "reject_offer":
      return { title: `Rejected by ${String(args.by ?? "the store team")}`, detail: row.agentReason ? `Note to buyer: “${row.agentReason}”` : undefined, tone: "denied", reasons: [] };
    case "dispute_opened":
    case "dispute_updated": {
      const stage = disputeStageLabel(String(result.stage ?? "inquiry"));
      const status = String(result.status ?? "").toLowerCase().replace(/_/g, " ");
      const amount = typeof result.amount_cents === "number" ? ` for ${formatCents(result.amount_cents)}` : "";
      const outcome = result.outcome ? ` — outcome: ${words(String(result.outcome))}` : "";
      return {
        title: row.tool === "dispute_opened" ? `Buyer opened a PayPal ${stage}${amount}` : `PayPal ${stage} moved to “${status}”${outcome}`,
        detail: `${String(args.dispute_id ?? "")} · ${row.tool === "dispute_opened" ? status : `seen via ${String(args.source ?? "poll")}`}`,
        tone: result.outcome === "won_by_seller" || result.outcome === "cancelled" ? "allowed" : "error",
        reasons: [],
      };
    }
    case "mark_resolved":
      return { title: "Marked resolved", tone: "allowed", reasons };
    default:
      return { title: words(row.tool), tone: row.status === "blocked_by_policy" ? "denied" : "neutral", reasons };
  }
}
