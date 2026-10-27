import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, CircleCheck, CircleX, Gavel, MessageSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DisputeWorkbench, type DraftView } from "@/components/console/dispute-workbench";
import { db } from "@/db";
import { disputeDrafts, disputes, disputeSubmissions } from "@/db/schema";
import { SUBMIT_ACTIONS } from "@/lib/disputes/draft-rules";
import { disputeReasonLabel, disputeStageLabel, humanStatus } from "@/lib/disputes/map";
import { buildDisputeRecord } from "@/lib/disputes/record";
import { requireMerchant } from "@/lib/merchant-session";
import { formatCents } from "@/lib/money";

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function DisputeView({ params }: Pick<PageProps<"/console/disputes/[id]">, "params">) {
  await connection();
  const [session, { id }] = await Promise.all([requireMerchant(), params]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [dispute] = await db.select().from(disputes).where(and(eq(disputes.id, id), eq(disputes.merchantId, session.merchantId)));
  if (!dispute) notFound();

  const [record, [draft], submissions] = await Promise.all([
    buildDisputeRecord(id),
    db.select().from(disputeDrafts).where(eq(disputeDrafts.disputeId, id)).orderBy(desc(disputeDrafts.version)).limit(1),
    db.select().from(disputeSubmissions).where(eq(disputeSubmissions.disputeId, id)).orderBy(desc(disputeSubmissions.submittedAt)),
  ]);
  const allowed = SUBMIT_ACTIONS.filter((a) => dispute.allowedActions.includes(a));
  const draftView: DraftView | null = draft ? { ...draft, createdAt: draft.createdAt.toISOString() } : null;
  const c = record.caseRecord;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Gavel className="size-5 text-red-700 dark:text-red-400" />
        <h1 className="font-mono text-xl font-semibold">{dispute.paypalDisputeId}</h1>
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 capitalize dark:bg-red-950 dark:text-red-300">{disputeStageLabel(dispute.stage)}</span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {disputeReasonLabel(dispute.reason)} · {formatCents(dispute.amountCents, dispute.currency)} · {dispute.outcome ? `outcome: ${dispute.outcome.replace(/_/g, " ")}` : humanStatus(dispute.status)}
        </span>
        {dispute.sellerResponseDueAt && !dispute.outcome && <span className="text-sm font-medium text-red-700 dark:text-red-400">Respond by {dateTime.format(dispute.sellerResponseDueAt)}</span>}
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">What the buyer told PayPal</h2>
            {record.dispute.buyerStatements.length ? (
              record.dispute.buyerStatements.map((s, i) => (
                <p key={i} className="flex gap-2">
                  <MessageSquare className="mt-0.5 size-4 shrink-0 text-zinc-400" /> “{s.text}”
                </p>
              ))
            ) : (
              <p className="text-zinc-500">No statement.</p>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">The store&apos;s record</h2>
            {!record.order ? (
              <p className="text-zinc-500">No matching order in this store — the disputed payment didn&apos;t come through FirstReply.</p>
            ) : (
              <>
                <p>
                  {dispute.caseId ? (
                    <Link href={`/console/cases/${dispute.caseId}`} className="font-semibold hover:text-emerald-700">
                      {record.order.number} →
                    </Link>
                  ) : (
                    <span className="font-semibold">{record.order.number}</span>
                  )}{" "}
                  · {record.order.items.map((i) => `${i.name} × ${i.quantity}`).join(", ")} · {formatCents(record.order.totalCents)}
                </p>
                {record.order.shipments.map((s) => (
                  <p key={s.trackingNumber} className="text-zinc-600 dark:text-zinc-400">
                    {s.carrier} {s.trackingNumber} · {s.status.replace("_", " ")}
                  </p>
                ))}
                {c && (
                  <p className={`flex items-center gap-1.5 ${c.contactedStoreFirst ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-600"}`}>
                    {c.contactedStoreFirst ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
                    {c.contactedStoreFirst ? `Buyer talked to the agent first (${dateTime.format(c.openedAt)})` : "Buyer went straight to PayPal"}
                  </p>
                )}
                {c?.offers.map((o, i) => (
                  <p key={i} className="text-zinc-600 dark:text-zinc-400">
                    Offer: {o.type.replace(/_/g, " ")}
                    {o.amountCents ? ` ${formatCents(o.amountCents)}` : ""} — {o.status.replace(/_/g, " ")}
                  </p>
                ))}
              </>
            )}
          </section>

          {submissions.length > 0 && (
            <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Sent to PayPal</h2>
              {submissions.map((s) => (
                <p key={s.id} className="flex gap-2">
                  {s.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-red-600" />}
                  <span>
                    {s.action.replace(/_/g, " ")} · {dateTime.format(s.submittedAt)}
                    {!s.ok && s.paypalDebugId && <span className="text-xs text-zinc-500"> · debug id {s.paypalDebugId}</span>}
                  </span>
                </p>
              ))}
            </section>
          )}
        </div>

        <DisputeWorkbench
          key={draft?.id ?? "none"}
          disputeId={dispute.id}
          draft={draftView}
          allowed={allowed}
          amountCents={dispute.amountCents}
          currency={dispute.currency}
          closed={dispute.outcome != null}
        />
      </div>
    </div>
  );
}

export default function DisputePage(props: PageProps<"/console/disputes/[id]">) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/console/disputes" className="flex w-fit items-center gap-1.5 text-sm text-zinc-600 hover:text-emerald-700 dark:text-zinc-400">
        <ArrowLeft className="size-4" /> All disputes
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />}>
        <DisputeView params={props.params} />
      </Suspense>
    </div>
  );
}
