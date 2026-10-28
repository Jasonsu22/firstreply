/**
 * Day 14 scenario eval.
 *
 *   npm run eval:scenarios           # deterministic (~20) — no LLM
 *   npm run eval:scenarios -- --live # also run live LLM scripts (needs gateway)
 *   npm run eval:scenarios -- --json # machine-readable summary
 */
import "@/lib/load-env";
import { pool } from "@/db";
import { handleBuyerMessage } from "@/lib/agent/agent";
import { liveScenarios, runAllDeterministic, type ScenarioResult } from "@/lib/agent/eval/scenarios";
import { createScenarioOrder } from "@/lib/demo/scenario";
import { getLatestCase } from "@/lib/agent/cases";

const args = process.argv.slice(2);
const wantLive = args.includes("--live");
const asJson = args.includes("--json");

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`;

async function runLive(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const s of liveScenarios()) {
    const started = Date.now();
    try {
      const order = await createScenarioOrder(s.setup);
      const toolNames = new Set<string>();
      let lastStatus = "open";
      for (const message of s.messages) {
        const turn = await handleBuyerMessage(order.orderId, message);
        for (const t of turn.toolCalls) toolNames.add(t.name);
        lastStatus = turn.caseStatus;
      }
      const latest = await getLatestCase(order.orderId);
      if (latest) lastStatus = latest.status;

      const toolsOk = !s.expectToolsAny || s.expectToolsAny.some((t) => toolNames.has(t));
      const statusOk = !s.preferStatus || s.preferStatus.includes(lastStatus as never);
      const ok = toolsOk && statusOk;
      out.push({
        id: s.id,
        title: s.title,
        ok,
        detail: ok
          ? `status=${lastStatus} tools=[${[...toolNames].join(", ")}] ${Date.now() - started}ms`
          : `status=${lastStatus} (want ${s.preferStatus?.join("|") ?? "any"}); tools=[${[...toolNames].join(", ")}] (want any of ${s.expectToolsAny?.join("|")})`,
      });
    } catch (err) {
      out.push({
        id: s.id,
        title: s.title,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

async function main() {
  const det = runAllDeterministic();
  const live = wantLive ? await runLive() : [];
  const all = [...det.results, ...live];
  const passed = all.filter((r) => r.ok).length;
  const failed = all.length - passed;
  const rate = all.length === 0 ? 0 : Math.round((passed / all.length) * 1000) / 10;

  if (asJson) {
    console.log(JSON.stringify({ passed, failed, total: all.length, passRatePercent: rate, results: all }, null, 2));
  } else {
    console.log(`\nFirstReply scenario eval — ${all.length} scenarios${wantLive ? " (incl. live)" : ""}\n`);
    for (const r of all) {
      const mark = r.ok ? green("PASS") : red("FAIL");
      console.log(`${mark}  ${r.id.padEnd(28)} ${r.title}`);
      console.log(grey(`       ${r.detail}`));
    }
    console.log(`\nPass rate: ${passed}/${all.length} (${rate}%)\n`);
  }

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
