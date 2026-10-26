/**
 * Day 1: checks that the LLM gateway supports what the agent needs.
 *
 *   npm run llm:check                        # uses LLM_PROTOCOL from .env
 *   npm run llm:check -- --protocol=both     # tries openai and anthropic formats
 *   npm run llm:check -- --model=some-model  # override LLM_MODEL
 */
import "@/lib/load-env";
import { deflateSync } from "node:zlib";
import { generateText, isStepCount, Output, streamText, tool } from "ai";
import { z } from "zod";
import { getLlmConfig, getModel, type LlmProtocol } from "@/lib/llm";

type Result = { test: string; pass: boolean; ms: number; detail: string };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

async function timed(test: string, fn: () => Promise<{ pass: boolean; detail: string }>): Promise<Result> {
  const start = Date.now();
  try {
    const { pass, detail } = await fn();
    return { test, pass, ms: Date.now() - start, detail };
  } catch (err) {
    return { test, pass: false, ms: Date.now() - start, detail: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  const e = err as { message?: string; statusCode?: number; responseBody?: string };
  return [e.statusCode && `HTTP ${e.statusCode}`, e.message, e.responseBody?.slice(0, 300)]
    .filter(Boolean)
    .join(" — ");
}

/** A tiny solid-red PNG, built in code so the test needs no image file. */
function redPng(size = 64): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([220, 20, 20]))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function runChecks(protocol: LlmProtocol): Promise<Result[]> {
  const config = getLlmConfig({ protocol, ...(args.model && { model: args.model }) });
  const model = getModel(config);
  console.log(`\n▶ ${protocol} format — ${config.baseURL} — model ${config.model}`);

  const results: Result[] = [];

  results.push(
    await timed("text", async () => {
      const { text } = await generateText({ model, prompt: "Reply with exactly the word: pong" });
      return { pass: /pong/i.test(text), detail: text.trim().slice(0, 80) };
    }),
  );

  results.push(
    await timed("tool calling", async () => {
      const calls: string[] = [];
      const { text, steps } = await generateText({
        model,
        system: "You are a store support agent. Always look up the order before answering.",
        prompt: "Hi, my order #1001 never arrived. What's going on?",
        tools: {
          get_shipment_status: tool({
            description: "Get the shipment status for an order number",
            inputSchema: z.object({ order_number: z.string().describe("The order number, digits only") }),
            execute: async ({ order_number }) => {
              calls.push(order_number);
              return { order_number, carrier: "UPS", status: "ON_HOLD", last_scan: "Memphis hub, Oct 20" };
            },
          }),
        },
        stopWhen: isStepCount(4),
      });
      const usedResult = /memphis|hold|ups/i.test(text);
      return {
        pass: calls.some((c) => c.includes("1001")) && usedResult,
        detail: `tool called with ${JSON.stringify(calls)}; ${steps.length} steps; answer used result: ${usedResult}`,
      };
    }),
  );

  results.push(
    await timed("streaming", async () => {
      const result = streamText({ model, prompt: "Count from 1 to 20, separated by spaces." });
      let chunks = 0;
      let text = "";
      for await (const part of result.textStream) {
        chunks++;
        text += part;
      }
      return { pass: chunks > 1 && /20/.test(text), detail: `${chunks} chunks` };
    }),
  );

  results.push(
    await timed("structured JSON", async () => {
      const { output } = await generateText({
        model,
        output: Output.object({
          schema: z.object({
            issue_type: z.enum(["NOT_RECEIVED", "NOT_AS_DESCRIBED", "DAMAGED", "UNRECOGNIZED_CHARGE", "OTHER"]),
            order_number: z.string().nullable(),
            buyer_mood: z.enum(["calm", "frustrated", "angry"]),
          }),
        }),
        prompt: "Classify this buyer message: 'This is ridiculous, order 2042 showed up with a cracked screen!!'",
      });
      return { pass: output.issue_type === "DAMAGED", detail: JSON.stringify(output) };
    }),
  );

  results.push(
    await timed("image input", async () => {
      const { text } = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is the main color of this image? Answer with one word." },
              { type: "file", mediaType: "image/png", data: redPng() },
            ],
          },
        ],
      });
      return { pass: /red/i.test(text), detail: text.trim().slice(0, 80) };
    }),
  );

  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.test.padEnd(16)} ${String(r.ms).padStart(6)} ms  ${r.detail}`);
  }
  return results;
}

async function main() {
  const choice = args.protocol ?? process.env.LLM_PROTOCOL ?? "openai";
  const protocols: LlmProtocol[] = choice === "both" ? ["openai", "anthropic"] : [choice as LlmProtocol];

  let toolCallingWorks = false;
  for (const p of protocols) {
    const results = await runChecks(p);
    if (results.find((r) => r.test === "tool calling")?.pass) toolCallingWorks = true;
  }

  console.log(
    toolCallingWorks
      ? "\n✔ Tool calling works — the agent can run on this setup."
      : "\n✘ Tool calling failed — try the other format or another model before building the agent.",
  );
  process.exitCode = toolCallingWorks ? 0 : 1;
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exitCode = 1;
});
