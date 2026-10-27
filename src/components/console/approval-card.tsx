"use client";

import { Clock, LoaderCircle, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { approveAction, rejectAction, type DecisionResult } from "@/app/console/actions";
import type { ApprovalItem } from "@/lib/console/approvals";
import { ISSUE_LABEL, TierBadge } from "./badges";

const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

function dueText(iso: string) {
  const hours = (new Date(iso).getTime() - Date.now()) / 3600_000;
  if (hours < 0) return { text: `Overdue by ${Math.ceil(-hours)} h`, overdue: true };
  if (hours < 1) return { text: "Due within the hour", overdue: false };
  return { text: `Due in ${Math.round(hours)} h`, overdue: false };
}

/** One fix waiting for the merchant: what the agent proposed, why the policy held it, and the decision buttons. */
export function ApprovalCard({ item }: { item: ApprovalItem }) {
  const [mode, setMode] = useState<"idle" | "confirm-approve" | "reject">("idle");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<DecisionResult>();
  const [pending, startTransition] = useTransition();
  const due = dueText(item.dueAt);

  // The card stays in place with its result; the queue itself updates on the next visit.
  const decide = (fn: () => Promise<DecisionResult>) =>
    startTransition(async () => {
      setResult(await fn());
    });

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex flex-col">
          <span className="text-lg font-semibold">{item.offerLabel}</span>
          <span className="text-sm text-zinc-500">
            <Link href={`/console/cases/${item.caseId}`} className="font-medium text-zinc-700 hover:text-emerald-700 dark:text-zinc-300">
              {item.orderNumber}
            </Link>{" "}
            · {ISSUE_LABEL[item.issueType] ?? item.issueType} · order total {money(item.orderAmountCents, item.currency)}
          </span>
        </div>
        <span className={`ml-auto flex items-center gap-1.5 text-sm ${due.overdue ? "font-medium text-red-700 dark:text-red-400" : "text-zinc-500"}`}>
          <Clock className="size-4" /> {due.text}
        </span>
      </header>

      <div className="grid gap-4 text-sm md:grid-cols-3">
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Buyer</h3>
          <p className="break-all">{item.buyerName ?? item.buyerEmail}</p>
          <span className="w-fit">
            <TierBadge tier={item.buyerTier} />
          </span>
          {item.tierReasons.length > 0 && <p className="text-xs text-zinc-500">{item.tierReasons.join(" · ")}</p>}
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Why it needs you</h3>
          <p>{item.requestedReason}</p>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Agent&apos;s note</h3>
          {item.agentNote ? <p className="text-zinc-700 dark:text-zinc-300">{item.agentNote}</p> : <p className="text-zinc-400">—</p>}
          {item.lastBuyerMessage && (
            <p className="flex gap-1.5 text-xs text-zinc-500">
              <MessageSquare className="mt-0.5 size-3.5 shrink-0" /> “{item.lastBuyerMessage}”
            </p>
          )}
        </section>
      </div>

      {result && (
        <p className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"}`}>
          {result.ok ? result.message : result.error}
          {result.ok && (
            <>
              {" "}
              <Link href={`/console/cases/${item.caseId}`} className="font-medium underline">
                View case
              </Link>
            </>
          )}
        </p>
      )}

      {!result?.ok && (
        <footer className="flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          {mode === "reject" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Note to the buyer <span className="font-normal text-zinc-500">(optional, shown in their chat)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-normal outline-none focus:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-950"
                placeholder="e.g. Tracking shows it was delivered to your front porch on Oct 24."
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {mode === "confirm-approve" ? (
              <>
                <button
                  disabled={pending}
                  onClick={() => decide(() => approveAction(item.id))}
                  className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {pending && <LoaderCircle className="size-4 animate-spin" />}
                  {item.offerType === "reship" ? "Yes, send the replacement" : `Yes, refund ${money(item.atStakeCents, item.currency)} now`}
                </button>
                <span className="text-xs text-zinc-500">Runs through PayPal right away.</span>
              </>
            ) : mode === "reject" ? (
              <button
                disabled={pending}
                onClick={() => decide(() => rejectAction(item.id, note))}
                className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
              >
                {pending && <LoaderCircle className="size-4 animate-spin" />} Reject and tell the buyer
              </button>
            ) : (
              <>
                <button onClick={() => setMode("confirm-approve")} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                  Approve
                </button>
                <button onClick={() => setMode("reject")} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  Reject
                </button>
              </>
            )}
            {mode !== "idle" && !pending && (
              <button onClick={() => setMode("idle")} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Cancel
              </button>
            )}
          </div>
        </footer>
      )}
    </article>
  );
}
