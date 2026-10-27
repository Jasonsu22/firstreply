import { connection } from "next/server";
import { Suspense } from "react";
import { PolicyEditor } from "@/components/console/policy-form";
import { getPolicy, toForm } from "@/lib/console/policies";
import { requireMerchant } from "@/lib/merchant-session";

async function Editor() {
  await connection();
  const session = await requireMerchant();
  const policy = await getPolicy(session.merchantId);
  if (!policy) return <p className="text-sm text-zinc-500">No policy found for this store.</p>;
  return <PolicyEditor values={toForm(policy)} />;
}

export default function PoliciesPage() {
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Policies</h1>
        <p className="text-sm text-zinc-500">
          Your rules for the agent. It can only offer what these allow — the checks run in code before any money moves, not in the AI&apos;s prompt.
        </p>
      </header>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-zinc-200/60 dark:bg-zinc-800/60" />}>
        <Editor />
      </Suspense>
    </div>
  );
}
