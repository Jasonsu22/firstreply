import { connection } from "next/server";
import { Suspense } from "react";
import { DisputesGrid } from "@/components/console/disputes-grid";
import { lastDisputeCheck, listDisputes } from "@/lib/console/disputes";
import { requireMerchant } from "@/lib/merchant-session";

async function Disputes() {
  await connection();
  const session = await requireMerchant();
  const [rows, check] = await Promise.all([listDisputes(session.merchantId), lastDisputeCheck(session.merchantId)]);
  return <DisputesGrid initialRows={rows} initialCheck={check} />;
}

export default function DisputesPage() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Disputes</h1>
        <p className="text-sm text-zinc-500">
          Cases buyers opened with PayPal, matched to your orders. FirstReply checks PayPal every minute and on webhooks; a dispute on an order the agent already handled links to that case and its record.
        </p>
      </header>
      <Suspense fallback={<div className="h-[360px] animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />}>
        <Disputes />
      </Suspense>
    </div>
  );
}
