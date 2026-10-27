"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { disputes, merchantUsers } from "@/db/schema";
import { approve, ApprovalError, reject } from "@/lib/console/approvals";
import { PolicyForm, savePolicy, type PolicyValues } from "@/lib/console/policies";
import { draftDisputeResponse } from "@/lib/disputes/agent";
import type { SubmitAction } from "@/lib/disputes/draft-rules";
import { SubmitError, submitDraft } from "@/lib/disputes/submit";
import { fetchDispute, syncDisputes, upsertDispute } from "@/lib/disputes/sync";
import { checkPassword, demoConsoleOpen, endMerchantSession, requireMerchant, startMerchantSession } from "@/lib/merchant-session";
import { formatCents } from "@/lib/money";

const DEMO_OWNER_EMAIL = "owner@trailhead.test";

// Wrong-password throttle per IP. In memory: fine for the single hackathon instance.
const failures = new Map<string, number[]>();

export type SignInState = { error?: string; email?: string };

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
  if (recent.length >= 8) return { error: "Too many attempts. Please wait a few minutes.", email };

  const userId = email && password ? await checkPassword(email, password) : undefined;
  if (!userId) {
    failures.set(ip, [...recent, Date.now()]);
    return { error: "That email and password don't match.", email };
  }
  await startMerchantSession(userId);
  redirect("/console");
}

/** One-click entry to the demo store's console, only when DEMO_CONSOLE_OPEN=true. */
export async function demoSignIn() {
  if (!demoConsoleOpen()) redirect("/console/login");
  const [user] = await db.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.email, DEMO_OWNER_EMAIL));
  if (!user) redirect("/console/login");
  await startMerchantSession(user.id);
  redirect("/console");
}

export async function signOut() {
  await endMerchantSession();
  redirect("/console/login");
}

// ── Approvals (day 8) ─────────────────────────────────────────────────────────

export type DecisionResult = { ok: true; message: string } | { ok: false; error: string };

export async function approveAction(approvalId: string, note?: string): Promise<DecisionResult> {
  const session = await requireMerchant();
  try {
    const done = await approve(session, approvalId, note);
    const message =
      done.kind === "refund"
        ? `Refunded ${formatCents(done.amountCents)} through PayPal${done.paypalRefundId ? ` (${done.paypalRefundId})` : ""}. The buyer has been told.`
        : done.kind === "reship"
          ? `Replacement created (${done.carrier} ${done.trackingNumber}). The buyer has been told.`
          : "Return approved. The buyer has the instructions.";
    return { ok: true, message };
  } catch (err) {
    if (err instanceof ApprovalError) return { ok: false, error: err.message };
    console.error("approve failed", err);
    return { ok: false, error: "Something went wrong and nothing was sent. Please try again." };
  }
}

export async function rejectAction(approvalId: string, noteToBuyer?: string): Promise<DecisionResult> {
  const session = await requireMerchant();
  try {
    await reject(session, approvalId, noteToBuyer?.slice(0, 500));
    return { ok: true, message: "Rejected. The buyer has been told." };
  } catch (err) {
    if (err instanceof ApprovalError) return { ok: false, error: err.message };
    console.error("reject failed", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// ── Policies (day 8) ──────────────────────────────────────────────────────────

export type PolicySaveState = { ok?: string; error?: string; fieldErrors?: Partial<Record<keyof PolicyValues, string>>; values?: PolicyValues };

export async function savePolicyAction(_prev: PolicySaveState, form: FormData): Promise<PolicySaveState> {
  const session = await requireMerchant();
  const parsed = PolicyForm.safeParse({ ...Object.fromEntries(form), reshipAllowed: form.get("reshipAllowed") === "on" });
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message]));
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  const { changed, rescored } = await savePolicy(session.merchantId, session.email, parsed.data);
  if (!changed) return { ok: "No changes.", values: parsed.data };
  return { values: parsed.data, ok: `Saved ${changed} change${changed > 1 ? "s" : ""}.${rescored ? ` Re-scored ${rescored} buyers with the new thresholds.` : ""} The agent uses them from the next message.` };
}

// ── Disputes (day 10) ─────────────────────────────────────────────────────────

export async function checkDisputesNowAction(): Promise<DecisionResult> {
  const session = await requireMerchant();
  const r = await syncDisputes(session.merchantId, "manual");
  if (r.errors.length && !r.checked) return { ok: false, error: `PayPal didn't answer: ${r.errors[0]}` };
  const news = r.created || r.updated ? `${r.created} new, ${r.updated} updated` : "No changes";
  return { ok: true, message: `${news}. PayPal's list can lag a few minutes behind — add a dispute by its ID to see it at once.` };
}

export async function addDisputeAction(disputeId: string): Promise<DecisionResult> {
  const session = await requireMerchant();
  try {
    const { dispute, isNew } = await upsertDispute(session.merchantId, await fetchDispute(disputeId.trim().toUpperCase()), "manual");
    const match = dispute.orderId ? "matched to its order" : "no matching order in this store";
    return { ok: true, message: `${dispute.paypalDisputeId} ${isNew ? "added" : "refreshed"} — ${match}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Dispute responses (day 11) ────────────────────────────────────────────────

export async function draftDisputeAction(disputeId: string): Promise<DecisionResult> {
  const session = await requireMerchant();
  const [dispute] = await db.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.id, disputeId), eq(disputes.merchantId, session.merchantId)));
  if (!dispute) return { ok: false, error: "Dispute not found." };
  try {
    const draft = await draftDisputeResponse(dispute.id);
    return { ok: true, message: `Draft v${draft.version} ready.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function submitDisputeAction(draftId: string, edits: { responseText: string; action: SubmitAction }): Promise<DecisionResult> {
  const session = await requireMerchant();
  try {
    const r = await submitDraft(session, draftId, edits);
    return { ok: true, message: `Sent to PayPal (${r.action.replace(/_/g, " ")}, draft v${r.version}). PayPal now shows: ${r.status.toLowerCase().replace(/_/g, " ")}.` };
  } catch (err) {
    if (err instanceof SubmitError) return { ok: false, error: err.message };
    console.error("dispute submit failed", err);
    return { ok: false, error: "Something went wrong before anything was sent. Please try again." };
  }
}
