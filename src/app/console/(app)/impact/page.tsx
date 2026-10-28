import { connection } from "next/server";
import { Suspense } from "react";
import { DISPUTE_COST_MULTIPLIER, formatMinutes, loadImpact, type CountRow, type ImpactStats } from "@/lib/console/impact";
import { requireMerchant } from "@/lib/merchant-session";
import { formatCents } from "@/lib/money";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function Breakdown({ title, rows, empty }: { title: string; rows: CountRow[]; empty: string }) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{r.label}</span>
                <span className="tabular-nums text-zinc-500">{r.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500" style={{ width: `${Math.max(4, (r.count / total) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Dashboard({ stats }: { stats: ImpactStats }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Disputes prevented"
          value={String(stats.disputesPrevented)}
          hint={`${stats.resolvedCount} resolved · ${stats.disputedCount} still disputed · ${stats.casesTotal} total cases`}
        />
        <StatCard
          label="Est. dispute cost avoided"
          value={formatCents(stats.moneySavedCents)}
          hint={`Order value ${formatCents(stats.preventedOrderCents)} × ${DISPUTE_COST_MULTIPLIER} dispute-cost factor`}
        />
        <StatCard label="Avg time to resolve" value={formatMinutes(stats.avgMinutesToResolve)} hint="From first message to closed case" />
        <StatCard label="Open now" value={String(stats.openCount)} hint="Awaiting buyer, merchant, or the agent" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="How fixes were decided" rows={stats.byRoute} empty="No resolved cases yet." />
        <Breakdown title="Where buyers started" rows={stats.byDoor} empty="No chat sessions linked yet." />
        <Breakdown title="Issue type" rows={stats.byIssue} empty="No cases yet." />
        <Breakdown title="Buyer trust at open" rows={stats.byTier} empty="No cases yet." />
      </div>

      <p className="text-xs text-zinc-500">
        “Disputes prevented” are resolved or closed cases that never linked to a PayPal dispute. The {DISPUTE_COST_MULTIPLIER}×
        factor is the industry estimate of dispute handling cost relative to the order value (PLAN.md).
      </p>
    </div>
  );
}

async function ImpactBody() {
  await connection();
  const session = await requireMerchant();
  const stats = await loadImpact(session.merchantId);
  return <Dashboard stats={stats} />;
}

export default function ImpactPage() {
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Impact</h1>
        <p className="text-sm text-zinc-500">
          Disputes you never had to fight — because the agent fixed the order first.
        </p>
      </header>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-zinc-200/60 dark:bg-zinc-800/60" />}>
        <ImpactBody />
      </Suspense>
    </div>
  );
}
