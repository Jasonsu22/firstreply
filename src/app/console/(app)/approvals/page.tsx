import { CircleCheck, CircleX } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ApprovalCard } from "@/components/console/approval-card";
import { listApprovals } from "@/lib/console/approvals";
import { requireMerchant } from "@/lib/merchant-session";
import { formatCents } from "@/lib/money";

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function Queue() {
  await connection();
  const session = await requireMerchant();
  const [pending, decided] = await Promise.all([listApprovals(session.merchantId, "pending"), listApprovals(session.merchantId, "decided", 10)]);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nothing waiting. The agent handles everything inside your policy on its own.
          </p>
        ) : (
          pending.map((item) => <ApprovalCard key={item.id} item={item} />)
        )}
      </section>

      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-500">Recently decided</h2>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white text-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {decided.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                {d.status === "approved" ? <CircleCheck className="size-4 text-emerald-600" /> : <CircleX className="size-4 text-zinc-400" />}
                <Link href={`/console/cases/${d.caseId}`} className="font-medium hover:text-emerald-700">
                  {d.orderNumber}
                </Link>
                <span>{d.offerLabel}</span>
                <span className="text-zinc-500">{d.status}</span>
                {d.decisionNote && <span className="text-zinc-500 italic">“{d.decisionNote}”</span>}
                <span className="ml-auto text-xs text-zinc-500">{d.decidedAt ? dateTime.format(new Date(d.decidedAt)) : ""}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500">
            Approved so far: {formatCents(decided.filter((d) => d.status === "approved").reduce((sum, d) => sum + d.atStakeCents, 0))} across{" "}
            {decided.filter((d) => d.status === "approved").length} fixes (last 10 decisions).
          </p>
        </section>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-zinc-500">Fixes your policy held back for you to decide. Approving runs the refund or replacement through PayPal and tells the buyer.</p>
      </header>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />}>
        <Queue />
      </Suspense>
    </div>
  );
}
