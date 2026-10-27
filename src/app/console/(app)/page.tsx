import { connection } from "next/server";
import { Suspense } from "react";
import { CasesGrid } from "@/components/console/cases-grid";
import { listCases } from "@/lib/console/cases";
import { requireMerchant } from "@/lib/merchant-session";

async function Cases() {
  await connection();
  const session = await requireMerchant();
  return <CasesGrid initialRows={await listCases(session.merchantId)} />;
}

export default function CasesPage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cases</h1>
        <p className="text-sm text-zinc-500">Every buyer problem the agent handled, and what it did. Click a row for the full record.</p>
      </header>
      <Suspense fallback={<div className="h-[420px] animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />}>
        <Cases />
      </Suspense>
    </div>
  );
}
