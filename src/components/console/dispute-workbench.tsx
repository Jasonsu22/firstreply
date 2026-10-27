"use client";

/**
 * The merchant's side of a dispute: ask the agent for a draft, read its recommendation and reasoning, edit the
 * text, preview the evidence PDF, and send it to PayPal with an explicit confirm step.
 */
import { AlertTriangle, Bot, FileText, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { draftDisputeAction, submitDisputeAction, type DecisionResult } from "@/app/console/actions";
import type { SubmitAction } from "@/lib/disputes/draft-rules";

export type DraftView = {
  id: string;
  version: number;
  recommendation: "fight" | "offer" | "accept";
  action: SubmitAction;
  reasoning: string;
  responseText: string;
  evidencePlan: { type: string; description: string; source: string }[];
  offerAmountCents: number | null;
  createdBy: "agent" | "merchant";
  createdAt: string;
};

const RECOMMENDATION = {
  fight: { label: "Fight it", tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  offer: { label: "Make an offer", tone: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  accept: { label: "Accept the claim", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
};

const ACTION_LABEL: Record<SubmitAction, string> = {
  provide_evidence: "Provide evidence (with the case-record PDF)",
  provide_supporting_info: "Provide supporting info (with the case-record PDF)",
  make_offer: "Make an offer",
  accept_claim: "Accept the claim (PayPal refunds the buyer)",
  send_message: "Send the buyer a message",
};

const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export function DisputeWorkbench({
  disputeId,
  draft,
  allowed,
  amountCents,
  currency,
  closed,
}: {
  disputeId: string;
  draft: DraftView | null;
  allowed: SubmitAction[];
  amountCents: number;
  currency: string;
  closed: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(draft?.responseText ?? "");
  const [action, setAction] = useState<SubmitAction | undefined>(draft && allowed.includes(draft.action) ? draft.action : allowed[0]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DecisionResult>();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<DecisionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      setConfirming(false);
      if (r.ok) router.refresh();
    });

  const consequence =
    action === "accept_claim"
      ? `PayPal refunds ${money(amountCents, currency)} to the buyer and closes the case in their favour.`
      : action === "make_offer" && draft?.offerAmountCents
        ? `The buyer is offered a ${money(draft.offerAmountCents, currency)} refund; nothing moves unless they accept.`
        : "PayPal's reviewer receives this text and the case-record PDF.";

  if (!draft) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-zinc-300 p-6 dark:border-zinc-700">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The dispute agent reads the whole case record — tracking, the chat, every offer and policy decision — and recommends whether to fight, offer or accept. You review it before anything is sent.
        </p>
        <button
          disabled={pending || closed || !allowed.length}
          onClick={() => run(() => draftDisputeAction(disputeId))}
          className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Draft a response with the agent
        </button>
        {!allowed.length && !closed && <p className="text-xs text-zinc-500">PayPal isn&apos;t accepting a response from the seller right now.</p>}
        {result && !result.ok && <p className="text-sm text-red-700 dark:text-red-400">{result.error}</p>}
      </section>
    );
  }

  const rec = RECOMMENDATION[draft.recommendation];
  const [why, ...warnings] = draft.reasoning.split("\n⚠ ");

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-zinc-500" />
        <span className="text-sm text-zinc-500">
          Draft v{draft.version} · {draft.createdBy === "agent" ? "by the dispute agent" : "edited by you"}
        </span>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${rec.tone}`}>Recommends: {rec.label}</span>
      </header>

      <div className="flex flex-col gap-2 text-sm">
        <p className="text-zinc-700 dark:text-zinc-300">{why}</p>
        {warnings.map((w) => (
          <p key={w} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
          </p>
        ))}
      </div>

      {draft.evidencePlan.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Evidence from the record</h3>
          <ul className="flex flex-col gap-1">
            {draft.evidencePlan.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{e.type}</span>
                <span>
                  {e.description} <span className="text-xs text-zinc-500">({e.source})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {closed ? (
        <p className="text-sm text-zinc-500">This dispute is closed.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            What PayPal will read
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              maxLength={2000}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-normal leading-relaxed outline-none focus:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <span className="text-right text-xs font-normal text-zinc-500">{text.length} / 2,000</span>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Action
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as SubmitAction)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-normal dark:border-zinc-700 dark:bg-zinc-950"
            >
              {allowed.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                  {a === draft.action ? (draft.createdBy === "agent" ? " — recommended" : " — last used") : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            {confirming && action ? (
              <>
                <p className="w-full text-sm text-zinc-700 dark:text-zinc-300">{consequence}</p>
                <button
                  disabled={pending}
                  onClick={() => run(() => submitDisputeAction(draft.id, { responseText: text, action }))}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${action === "accept_claim" ? "bg-amber-700 hover:bg-amber-800" : "bg-emerald-700 hover:bg-emerald-800"}`}
                >
                  {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />} Yes, send to PayPal
                </button>
                <button onClick={() => setConfirming(false)} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={!action || !text.trim() || !allowed.length}
                  onClick={() => setConfirming(true)}
                  className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <Send className="size-4" /> Send to PayPal…
                </button>
                <a
                  href={`/api/console/disputes/${disputeId}/evidence`}
                  target="_blank"
                  className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <FileText className="size-4" /> Preview evidence PDF
                </a>
                <button
                  disabled={pending}
                  onClick={() => run(() => draftDisputeAction(disputeId))}
                  className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
                >
                  {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Redraft
                </button>
              </>
            )}
          </div>
        </>
      )}

      {result && (
        <p className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"}`}>
          {result.ok ? result.message : result.error}
        </p>
      )}
    </section>
  );
}
