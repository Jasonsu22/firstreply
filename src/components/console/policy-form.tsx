"use client";

import { LoaderCircle } from "lucide-react";
import { startTransition, useActionState, type ReactNode } from "react";
import { savePolicyAction, type PolicySaveState } from "@/app/console/actions";
import type { PolicyValues } from "@/lib/console/policies";

const input =
  "w-24 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-right tabular-nums outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 aria-invalid:border-red-500 dark:border-zinc-700 dark:bg-zinc-950";

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-zinc-200 py-6 last:border-0 md:grid-cols-[16rem_1fr] dark:border-zinc-800">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-zinc-500">{hint}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function NumberField({
  name,
  label,
  help,
  defaultValue,
  prefix,
  suffix,
  step = 1,
  error,
}: {
  name: keyof PolicyValues;
  label: string;
  help?: string;
  defaultValue: number;
  prefix?: string;
  suffix?: string;
  step?: number;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2">
        {prefix && <span className="text-zinc-500">{prefix}</span>}
        <input name={name} type="number" inputMode="decimal" step={step} min={0} defaultValue={defaultValue} required aria-invalid={!!error} className={input} />
        {suffix && <span className="text-zinc-500">{suffix}</span>}
      </span>
      {help && <span className="text-xs text-zinc-500">{help}</span>}
      {error && <span className="text-xs text-red-700 dark:text-red-400">{error}</span>}
    </label>
  );
}

export function PolicyEditor({ values }: { values: PolicyValues }) {
  const [state, action, pending] = useActionState<PolicySaveState, FormData>(savePolicyAction, {});
  const e = state.fieldErrors ?? {};
  // Submitted by hand so React doesn't reset the fields; after a save, remount with the saved values.
  const current = state.values ?? values;

  return (
    <form
      key={JSON.stringify(current)}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col rounded-xl border border-zinc-200 bg-white px-5 dark:border-zinc-800 dark:bg-zinc-900">
      <Section title="Automatic refunds" hint="The agent refunds on its own up to these amounts. Above them, it asks you first. Watch and high-risk buyers always need you.">
        <NumberField name="autoRefundLimit" label="Normal buyers, up to" prefix="$" step={0.01} defaultValue={current.autoRefundLimit} error={e.autoRefundLimit} />
        <NumberField
          name="trustedAutoRefundLimit"
          label="Trusted buyers, up to"
          prefix="$"
          step={0.01}
          defaultValue={current.trustedAutoRefundLimit}
          help="Repeat customers with no claims in the last year."
          error={e.trustedAutoRefundLimit}
        />
      </Section>

      <Section title="Replacements" hint="Sending the item again instead of refunding. Counts against the same limits, at the order's value.">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input name="reshipAllowed" type="checkbox" defaultChecked={current.reshipAllowed} className="size-4 accent-emerald-700" />
          Allow replacements
        </label>
        <NumberField name="maxReshipsPerOrder" label="Most replacements per order" defaultValue={current.maxReshipsPerOrder} error={e.maxReshipsPerOrder} />
      </Section>

      <Section title="“Not received” claims" hint="Before this, the agent explains the delivery window instead of offering money.">
        <NumberField name="notReceivedWaitDays" label="Normal delivery window" suffix="days after shipping" defaultValue={current.notReceivedWaitDays} error={e.notReceivedWaitDays} />
      </Section>

      <Section title="Buyer trust" hint="How buyers move to Watch (every money fix needs you) or High risk. Changing these re-scores all your buyers.">
        <NumberField name="watchClaims90d" label="Watch after" suffix="claims in 90 days" defaultValue={current.watchClaims90d} error={e.watchClaims90d} />
        <NumberField
          name="watchClaimRatePct"
          label="…or a claim rate above"
          suffix="% of orders"
          defaultValue={current.watchClaimRatePct}
          help="Only counts once a buyer has at least 2 claims."
          error={e.watchClaimRatePct}
        />
        <NumberField
          name="highRiskDeliveredClaims"
          label="High risk after"
          suffix="“never arrived” claims on parcels tracked as delivered"
          defaultValue={current.highRiskDeliveredClaims}
          error={e.highRiskDeliveredClaims}
        />
      </Section>

      <Section title="Your reply time" hint="What the agent promises the buyer when a fix needs you.">
        <NumberField name="approvalSlaHours" label="Reply within" suffix="hours" defaultValue={current.approvalSlaHours} error={e.approvalSlaHours} />
      </Section>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 py-4 dark:border-zinc-800">
        <button disabled={pending} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60">
          {pending && <LoaderCircle className="size-4 animate-spin" />} Save rules
        </button>
        {state.ok && <p className="text-sm text-emerald-800 dark:text-emerald-300">{state.ok}</p>}
        {state.error && <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>}
      </div>
    </form>
  );
}
