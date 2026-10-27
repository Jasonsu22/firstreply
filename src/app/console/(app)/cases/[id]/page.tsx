import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  Clock,
  Gavel,
  Package,
  Search,
  ShieldCheck,
  Tag,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { ISSUE_LABEL, RESOLUTION_LABEL, StatusBadge, TierBadge } from "@/components/console/badges";
import { getCaseDetail, type CaseDetail, type TimelineItem } from "@/lib/console/cases";
import { disputeReasonLabel, disputeStageLabel, humanStatus } from "@/lib/disputes/map";
import type { Tone } from "@/lib/console/timeline";
import { requireMerchant } from "@/lib/merchant-session";
import { formatCents } from "@/lib/money";

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

const TONE: Record<Tone, { icon: LucideIcon; ring: string }> = {
  neutral: { icon: Tag, ring: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  check: { icon: Search, ring: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
  allowed: { icon: ShieldCheck, ring: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  approval: { icon: Clock, ring: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  denied: { icon: CircleX, ring: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  money: { icon: CircleDollarSign, ring: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" },
  error: { icon: AlertTriangle, ring: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

const OFFER_STATUS_TONE: Record<string, string> = {
  offered: "text-sky-700 dark:text-sky-300",
  pending_approval: "text-amber-700 dark:text-amber-300",
  executed: "text-emerald-700 dark:text-emerald-300",
  accepted: "text-emerald-700 dark:text-emerald-300",
  declined: "text-zinc-500",
  expired: "text-zinc-400",
  rejected_by_merchant: "text-red-700 dark:text-red-300",
};

function Card({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        <Icon className="size-3.5" /> {title}
      </h2>
      {children}
    </section>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const { icon: Icon, ring } = TONE[item.tone];
  return (
    <li className="group relative flex gap-3 pb-5 last:pb-0">
      <span className="absolute top-8 bottom-0 left-[15px] w-px bg-zinc-200 group-last:hidden dark:bg-zinc-800" aria-hidden />
      <span className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full ${ring}`}>
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{item.title}</span>
          <time className="text-xs text-zinc-500 tabular-nums" dateTime={item.at}>
            {time.format(new Date(item.at))}
          </time>
          {item.actor !== "agent" && <span className="text-xs text-zinc-500">by {item.actor}</span>}
        </div>
        {item.detail && <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.detail}</p>}
        {item.reasons.length > 0 && (
          <ul className="flex flex-col gap-1">
            {item.reasons.map((r) => (
              <li key={r} className="rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
                {r}
              </li>
            ))}
          </ul>
        )}
        {item.agentReason && <p className="text-xs text-zinc-500 italic">Agent&apos;s note: “{item.agentReason}”</p>}
        {item.paypalRef && <p className="font-mono text-xs text-violet-700 dark:text-violet-300">PayPal {item.paypalRef}</p>}
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200">Raw call: {item.tool}</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-[11px] leading-relaxed whitespace-pre-wrap dark:bg-zinc-950">
            {JSON.stringify(item.raw, null, 2)}
          </pre>
        </details>
      </div>
    </li>
  );
}

function Overview({ d }: { d: CaseDetail }) {
  const shipment = d.order.shipments.at(-1);
  const pending = d.approvals.find((a) => a.status === "pending");
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card title="Buyer" icon={User}>
        <p className="font-medium break-all">{d.buyer.name ?? d.buyer.email}</p>
        {d.buyer.name && <p className="text-zinc-500 break-all">{d.buyer.email}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={d.buyer.tier} />
          {d.case.trustTierAtOpen !== d.buyer.tier && <span className="text-xs text-zinc-500">({d.case.trustTierAtOpen.replace("_", " ")} when opened)</span>}
          {d.buyer.manualTier && <span className="text-xs text-zinc-500">set by you</span>}
        </div>
        {d.buyer.tierReasons.length > 0 && (
          <ul className="list-disc pl-4 text-xs text-zinc-600 dark:text-zinc-400">
            {d.buyer.tierReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Order" icon={Package}>
        <p className="flex justify-between">
          <span className="font-medium">{d.order.orderNumber}</span>
          <span className="tabular-nums">{formatCents(d.order.amountCents, d.order.currency)}</span>
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">{d.order.items.map((i) => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)).join(", ")}</p>
        {d.order.refundedCents > 0 && <p className="text-violet-700 dark:text-violet-300">{formatCents(d.order.refundedCents, d.order.currency)} refunded</p>}
        <p className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          <Truck className="size-3.5" />
          {shipment ? `${shipment.carrier} ${shipment.trackingNumber} · ${shipment.status.replace("_", " ")}${d.order.shipments.length > 1 ? ` (${d.order.shipments.length} shipments)` : ""}` : "Not shipped"}
        </p>
        {d.order.paypalCaptureId && <p className="font-mono text-xs text-zinc-500">Capture {d.order.paypalCaptureId}</p>}
      </Card>

      <Card title="Outcome" icon={CircleCheck}>
        <p className="font-medium">
          {d.case.resolutionType
            ? `${RESOLUTION_LABEL[d.case.resolutionType]}${d.case.resolutionAmountCents ? ` · ${formatCents(d.case.resolutionAmountCents)}` : ""}`
            : "Not resolved yet"}
        </p>
        {pending && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            Waiting for your approval · due {dateTime.format(pending.dueAt)}. ({pending.requestedReason})
          </p>
        )}
        {d.offers.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs">
            {d.offers.map((o) => (
              <li key={o.id} className="flex justify-between gap-2">
                <span>
                  {o.type.replace(/_/g, " ")}
                  {o.amountCents ? ` ${formatCents(o.amountCents)}` : ""}
                </span>
                <span className={OFFER_STATUS_TONE[o.status] ?? ""}>{o.status.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        )}
        {d.refunds.map((r) => (
          <p key={r.id} className="font-mono text-xs text-violet-700 dark:text-violet-300">
            Refund {r.paypalRefundId ?? "(pending)"} · {formatCents(r.amountCents)} · {r.status}
          </p>
        ))}
      </Card>
    </div>
  );
}

function DisputeBanner({ dispute, caseOpenedAt }: { dispute: CaseDetail["disputes"][number]; caseOpenedAt: string }) {
  const contactedFirst = new Date(caseOpenedAt) < dispute.createdAtPaypal;
  const done = dispute.outcome != null;
  return (
    <section
      className={`flex flex-col gap-2 rounded-xl border p-4 text-sm ${done ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Gavel className="size-4 text-red-700 dark:text-red-400" />
        <span className="font-semibold">
          PayPal {disputeStageLabel(dispute.stage)} · {disputeReasonLabel(dispute.reason)} · {formatCents(dispute.amountCents, dispute.currency)}
        </span>
        <span className="font-mono text-xs text-zinc-500">{dispute.paypalDisputeId}</span>
        <span className="ml-auto text-xs text-zinc-600 dark:text-zinc-400">
          {done ? `Outcome: ${dispute.outcome!.replace(/_/g, " ")}` : humanStatus(dispute.status)}
          {!done && dispute.sellerResponseDueAt && ` · respond by ${dateTime.format(dispute.sellerResponseDueAt)}`}
        </span>
      </div>
      <p className="text-zinc-700 dark:text-zinc-300">
        {contactedFirst
          ? "The buyer talked to the agent before disputing — the conversation and offers below are your evidence."
          : "The buyer went straight to PayPal without contacting the store."}{" "}
        {dispute.allowedActions.length > 0 ? `PayPal lets you: ${dispute.allowedActions.map((a) => a.replace(/_/g, " ")).join(", ")}.` : "PayPal is reviewing — no seller action available right now."}
      </p>
    </section>
  );
}

async function CaseView({ params }: Pick<PageProps<"/console/cases/[id]">, "params">) {
  await connection();
  const [session, { id }] = await Promise.all([requireMerchant(), params]);
  const d = await getCaseDetail(session.merchantId, id);
  if (!d) notFound();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{d.order.orderNumber}</h1>
        <StatusBadge status={d.case.status} />
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{ISSUE_LABEL[d.case.issueType]}</span>
        <span className="text-sm text-zinc-500">· opened {dateTime.format(new Date(d.case.openedAt))}</span>
      </header>

      {d.disputes.map((dispute) => (
        <DisputeBanner key={dispute.id} dispute={dispute} caseOpenedAt={d.case.openedAt} />
      ))}

      <Overview d={d} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">Conversation</h2>
          {d.conversation.length === 0 && <p className="text-sm text-zinc-500">No messages.</p>}
          <div className="flex flex-col gap-2">
            {d.conversation.map((b, i) => (
              <div key={i} className={`flex gap-2 ${b.role === "buyer" ? "flex-row-reverse" : ""}`}>
                <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
                  {b.role === "buyer" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                </span>
                <p
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                    b.role === "buyer" ? "rounded-tr-md bg-emerald-700 text-white" : "rounded-tl-md bg-zinc-100 dark:bg-zinc-800"
                  }`}
                >
                  {b.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <h2 className="text-sm font-semibold">What the agent did</h2>
            <p className="text-xs text-zinc-500">From the append-only audit log — every check, policy decision and PayPal call.</p>
          </div>
          {d.timeline.length === 0 ? (
            <p className="text-sm text-zinc-500">No actions yet.</p>
          ) : (
            <ol className="flex flex-col">
              {d.timeline.map((item) => (
                <TimelineRow key={item.id} item={item} />
              ))}
            </ol>
          )}
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer select-none">Case summary given to the agent</summary>
            <pre className="mt-1 rounded-md bg-zinc-50 p-2 whitespace-pre-wrap dark:bg-zinc-950">{d.summary}</pre>
          </details>
        </section>
      </div>
    </div>
  );
}

export default function CasePage(props: PageProps<"/console/cases/[id]">) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/console" className="flex w-fit items-center gap-1.5 text-sm text-zinc-600 hover:text-emerald-700 dark:text-zinc-400">
        <ArrowLeft className="size-4" /> All cases
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />}>
        <CaseView params={props.params} />
      </Suspense>
    </div>
  );
}
