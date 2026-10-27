/**
 * Day 10: run one dispute-watcher pass by hand (the server also polls every minute).
 *
 *   npm run disputes:sync                     # list recent disputes and pull new/changed ones
 *   npm run disputes:sync -- PP-R-ABC-123     # fetch one dispute by ID right away
 */
import "@/lib/load-env";
import { pool } from "@/db";
import { fetchDispute, syncDisputes, upsertDispute } from "@/lib/disputes/sync";
import { getDemoMerchant } from "@/lib/store";

async function main() {
  const merchant = await getDemoMerchant();
  const id = process.argv[2];
  if (id) {
    const { dispute, isNew, changed } = await upsertDispute(merchant.id, await fetchDispute(id), "manual");
    console.log({ dispute: dispute.paypalDisputeId, isNew, changed, status: dispute.status, stage: dispute.stage, matchedOrder: !!dispute.orderId, case: dispute.caseId });
    return;
  }
  console.log(await syncDisputes(merchant.id, "manual"));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
