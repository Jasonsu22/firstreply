/** Small status pills shared by the cases grid and the case page. Plain components: usable on server and client. */

const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  awaiting_buyer: { label: "Waiting on buyer", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  awaiting_merchant: { label: "Needs you", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  resolved: { label: "Resolved", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  escalated: { label: "Escalated", tone: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300" },
  disputed: { label: "Disputed", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  closed: { label: "Closed", tone: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: STATUS.closed.tone };
  return <span className={`${pill} ${s.tone}`}>{s.label}</span>;
}

const TIER: Record<string, { label: string; dot: string }> = {
  trusted: { label: "Trusted", dot: "bg-emerald-500" },
  normal: { label: "Normal", dot: "bg-zinc-400" },
  watch: { label: "Watch", dot: "bg-amber-500" },
  high_risk: { label: "High risk", dot: "bg-red-500" },
};

export function TierBadge({ tier }: { tier: string }) {
  const t = TIER[tier] ?? TIER.normal;
  return (
    <span className={`${pill} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>
      <span className={`size-1.5 rounded-full ${t.dot}`} aria-hidden />
      {t.label}
    </span>
  );
}

const DECISION: Record<string, { label: string; tone: string }> = {
  allowed: { label: "Auto-approved", tone: "text-emerald-700 dark:text-emerald-400" },
  needs_approval: { label: "Needs approval", tone: "text-amber-700 dark:text-amber-400" },
  denied: { label: "Refused by policy", tone: "text-red-700 dark:text-red-400" },
};

export function DecisionText({ decision }: { decision: string | null }) {
  if (!decision) return <span className="text-zinc-400">—</span>;
  const d = DECISION[decision];
  return <span className={`text-xs font-medium ${d?.tone ?? ""}`}>{d?.label ?? decision}</span>;
}

export const ISSUE_LABEL: Record<string, string> = {
  not_received: "Not received",
  not_as_described: "Not as described",
  damaged: "Damaged",
  unrecognized_charge: "Unrecognized charge",
  cancel: "Cancel",
  other: "Other",
};

export const RESOLUTION_LABEL: Record<string, string> = {
  full_refund: "Full refund",
  partial_refund: "Partial refund",
  reship: "Reship",
  explained: "Explained",
  denied: "Denied",
  none: "None",
};
