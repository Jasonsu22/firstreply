/**
 * The audit log: every tool call and decision becomes an append-only `actions` row,
 * and verified facts point at the row (real API result) that proves them (PLAN.md §7.7).
 */
import { db } from "@/db";
import { actions, caseFacts } from "@/db/schema";
import { PayPalError } from "@/lib/paypal/client";
import { ToolkitError } from "@/lib/paypal/toolkit";

type ActionInsert = typeof actions.$inferInsert;
type FactType = (typeof caseFacts.$inferInsert)["factType"];

export type ActionMeta = {
  merchantId: string;
  caseId: string | null;
  actor: ActionInsert["actor"];
  tool: string;
  args?: unknown;
  agentReason?: string | null;
};

/** Drops PayPal's HATEOAS `links` arrays — they bloat the log and the model's context. */
export function trimPayPal<T>(value: T): T {
  if (Array.isArray(value)) return value.map(trimPayPal) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "links").map(([k, v]) => [k, trimPayPal(v)])) as T;
  }
  return value;
}

export async function logAction(
  meta: ActionMeta & {
    result?: unknown;
    status: ActionInsert["status"];
    policyDecision?: ActionInsert["policyDecision"];
    policyReasons?: string[];
    paypalDebugId?: string | null;
  },
) {
  const [row] = await db
    .insert(actions)
    .values({
      merchantId: meta.merchantId,
      caseId: meta.caseId,
      actor: meta.actor,
      tool: meta.tool,
      arguments: meta.args ?? {},
      result: meta.result === undefined ? null : trimPayPal(meta.result),
      status: meta.status,
      policyDecision: meta.policyDecision ?? null,
      policyReasons: meta.policyReasons ?? null,
      agentReason: meta.agentReason ?? null,
      paypalDebugId: meta.paypalDebugId ?? null,
    })
    .returning();
  return row;
}

function debugIdOf(err: unknown): string | null {
  if (err instanceof PayPalError) return (err.body as { debug_id?: string })?.debug_id ?? null;
  if (err instanceof ToolkitError) return null;
  return null;
}

/**
 * Runs `fn` and logs the call either way. Returns the result and the action row,
 * so facts can point at the exact logged result that proves them.
 */
export async function audited<T>(meta: ActionMeta, fn: () => Promise<T>): Promise<{ result: T; actionId: string }> {
  try {
    const result = await fn();
    const row = await logAction({ ...meta, result, status: "ok" });
    return { result, actionId: row.id };
  } catch (err) {
    await logAction({
      ...meta,
      status: "error",
      result: { error: err instanceof Error ? err.message : String(err) },
      paypalDebugId: debugIdOf(err),
    });
    throw err;
  }
}

export async function addFact(caseId: string, factType: FactType, value: unknown, sourceActionId: string) {
  await db.insert(caseFacts).values({ caseId, factType, value, sourceActionId });
}
