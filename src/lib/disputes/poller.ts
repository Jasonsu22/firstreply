/**
 * Polls PayPal for dispute changes every minute while the server runs (started from src/instrumentation.ts).
 * On Render's free plan the server sleeps when idle; webhooks (and the console's "Check PayPal now") cover that gap.
 */
import { syncDisputes } from "./sync";
import { getDemoMerchant } from "@/lib/store";

const g = globalThis as typeof globalThis & { __disputePoller?: NodeJS.Timeout };

export function startDisputePoller() {
  const seconds = Number(process.env.DISPUTE_POLL_SECONDS ?? 60);
  if (!seconds || g.__disputePoller || !process.env.PAYPAL_CLIENT_ID || !process.env.DATABASE_URL) return;

  const tick = async () => {
    try {
      // One PayPal app = one merchant for now (sandbox demo). Multi-merchant polling loops over connected accounts.
      const merchant = await getDemoMerchant();
      const result = await syncDisputes(merchant.id);
      if (result.created || result.updated || result.errors.length) console.log("[disputes]", JSON.stringify(result));
    } catch (err) {
      console.error("[disputes] poll failed:", err instanceof Error ? err.message : err);
    }
  };
  g.__disputePoller = setInterval(tick, seconds * 1000);
  setTimeout(tick, 5000); // first pass shortly after start-up
  console.log(`[disputes] polling PayPal every ${seconds}s`);
}
