/** The merchant's rules (PLAN.md §7.4, §7.8). The policy engine reads them on every decision. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buyers, policies } from "@/db/schema";
import { logAction } from "@/lib/agent/audit";
import { recomputeBuyerTier } from "@/lib/policy/context";

/** Form values in plain units (dollars, days, hours). */
export const PolicyForm = z
  .object({
    autoRefundLimit: z.coerce.number().min(0).max(1000),
    trustedAutoRefundLimit: z.coerce.number().min(0).max(2000),
    reshipAllowed: z.boolean(),
    maxReshipsPerOrder: z.coerce.number().int().min(0).max(3),
    notReceivedWaitDays: z.coerce.number().int().min(1).max(30),
    watchClaims90d: z.coerce.number().int().min(1).max(10),
    watchClaimRatePct: z.coerce.number().int().min(5).max(100),
    highRiskDeliveredClaims: z.coerce.number().int().min(1).max(10),
    approvalSlaHours: z.coerce.number().int().min(1).max(168),
  })
  .refine((p) => p.trustedAutoRefundLimit >= p.autoRefundLimit, {
    path: ["trustedAutoRefundLimit"],
    message: "Trusted buyers' limit can't be lower than the normal limit.",
  });

export type PolicyValues = z.infer<typeof PolicyForm>;

type PolicyRow = typeof policies.$inferSelect;

export function toForm(p: PolicyRow): PolicyValues {
  return {
    autoRefundLimit: p.autoRefundLimitCents / 100,
    trustedAutoRefundLimit: p.trustedAutoRefundLimitCents / 100,
    reshipAllowed: p.reshipAllowed,
    maxReshipsPerOrder: p.maxReshipsPerOrder,
    notReceivedWaitDays: p.notReceivedWaitDays,
    watchClaims90d: p.watchClaims90d,
    watchClaimRatePct: p.watchClaimRatePct,
    highRiskDeliveredClaims: p.highRiskDeliveredClaims,
    approvalSlaHours: p.approvalSlaHours,
  };
}

export async function getPolicy(merchantId: string) {
  const [row] = await db.select().from(policies).where(eq(policies.merchantId, merchantId));
  return row;
}

/** Saves the rules, logs what changed, and re-scores every buyer if a trust threshold moved. */
export async function savePolicy(merchantId: string, by: string, values: PolicyValues) {
  const before = await getPolicy(merchantId);
  const patch = {
    autoRefundLimitCents: Math.round(values.autoRefundLimit * 100),
    trustedAutoRefundLimitCents: Math.round(values.trustedAutoRefundLimit * 100),
    reshipAllowed: values.reshipAllowed,
    maxReshipsPerOrder: values.maxReshipsPerOrder,
    notReceivedWaitDays: values.notReceivedWaitDays,
    watchClaims90d: values.watchClaims90d,
    watchClaimRatePct: values.watchClaimRatePct,
    highRiskDeliveredClaims: values.highRiskDeliveredClaims,
    approvalSlaHours: values.approvalSlaHours,
  };
  const changed = Object.fromEntries(
    Object.entries(patch)
      .filter(([k, v]) => before?.[k as keyof typeof patch] !== v)
      .map(([k, v]) => [k, { from: before?.[k as keyof typeof patch], to: v }]),
  );
  if (Object.keys(changed).length === 0) return { changed: 0, rescored: 0 };

  await db.update(policies).set({ ...patch, updatedAt: new Date() }).where(eq(policies.merchantId, merchantId));
  await logAction({ merchantId, caseId: null, actor: "merchant", tool: "update_policy", args: { by }, result: changed, status: "ok" });

  let rescored = 0;
  if (["watchClaims90d", "watchClaimRatePct", "highRiskDeliveredClaims"].some((k) => k in changed)) {
    const all = await db.select({ id: buyers.id }).from(buyers).where(eq(buyers.merchantId, merchantId));
    for (const b of all) await recomputeBuyerTier(b.id);
    rescored = all.length;
  }
  return { changed: Object.keys(changed).length, rescored };
}
