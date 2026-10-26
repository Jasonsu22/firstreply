/**
 * Day 5: talk to the Resolution Agent in the terminal as the buyer of an order.
 *
 *   npm run agent:chat -- FR-20002                       # interactive
 *   npm run agent:chat -- FR-20002 --say "It never came" --say "Yes please"   # scripted
 *
 * Tool calls are printed in grey so you can see what the agent checked and did.
 * Real PayPal sandbox calls happen (tracking lookups, refunds, reships).
 */
import "@/lib/load-env";
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { orders } from "@/db/schema";
import { handleBuyerMessage, type TurnResult } from "@/lib/agent/agent";

const grey = (s: string) => `\x1b[90m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

function show(turn: TurnResult) {
  for (const call of turn.toolCalls) {
    const out = JSON.stringify(call.output) ?? "";
    console.log(grey(`  ⚙ ${call.name}(${JSON.stringify(call.input)}) → ${out.length > 220 ? out.slice(0, 220) + "…" : out}`));
  }
  console.log(`${green("Agent:")} ${turn.reply}`);
  console.log(grey(`  [case ${turn.caseId.slice(0, 8)} · ${turn.caseStatus}]`));
}

async function main() {
  const args = process.argv.slice(2);
  const orderNumber = args.find((a) => !a.startsWith("--"));
  if (!orderNumber) {
    console.log('Usage: npm run agent:chat -- <ORDER_NUMBER> [--say "message" ...]');
    return;
  }
  const scripted = args.flatMap((a, i) => (a === "--say" && args[i + 1] ? [args[i + 1]] : []));

  const [order] = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber));
  if (!order) throw new Error(`No order ${orderNumber}`);
  console.log(bold(`Chatting as the buyer of ${orderNumber}. ${scripted.length ? "" : "Type 'quit' to stop."}\n`));

  if (scripted.length) {
    for (const message of scripted) {
      console.log(`${bold("Buyer:")} ${message}`);
      show(await handleBuyerMessage(order.id, message));
      console.log();
    }
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const message = (await rl.question(bold("Buyer: "))).trim();
      if (!message) continue;
      if (message === "quit" || message === "exit") break;
      show(await handleBuyerMessage(order.id, message));
      console.log();
    }
  } finally {
    rl.close();
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
