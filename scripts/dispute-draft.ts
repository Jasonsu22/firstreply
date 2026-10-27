/**
 * Day 11: ask the Dispute Agent to draft a response to one dispute (same as "Draft with the agent" in the console).
 *
 *   npm run disputes:draft -- PP-R-ABC-12345678
 */
import "@/lib/load-env";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { disputes } from "@/db/schema";
import { draftDisputeResponse } from "@/lib/disputes/agent";

async function main() {
  const id = process.argv[2];
  if (!id) return console.log("Usage: npm run disputes:draft -- <PP-R-… dispute ID>");
  const [dispute] = await db.select().from(disputes).where(eq(disputes.paypalDisputeId, id));
  if (!dispute) throw new Error(`${id} isn't in the database yet — run npm run disputes:sync -- ${id}`);
  const started = Date.now();
  const draft = await draftDisputeResponse(dispute.id);
  console.log(`Draft v${draft.version} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  console.log(`Recommendation: ${draft.recommendation} → ${draft.action}${draft.offerAmountCents ? ` ($${(draft.offerAmountCents / 100).toFixed(2)})` : ""}\n`);
  console.log(`Why:\n${draft.reasoning}\n`);
  console.log(`To PayPal:\n${draft.responseText}\n`);
  console.log("Evidence:");
  for (const e of draft.evidencePlan) console.log(`- [${e.type}] ${e.description} (${e.source})`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
