import { z } from "zod";
import { streamBuyerMessage, type TurnEvent } from "@/lib/agent/agent";
import { sessionFromRequest, touchSession } from "@/lib/help/session";
import { loadChatState, type ChatState } from "@/lib/help/state";

const Body = z.object({ message: z.string().trim().min(1).max(2000) });

/** What the client reads: one JSON object per line. */
export type ChatStreamLine = TurnEvent | { type: "done"; state: ChatState } | { type: "error"; message: string };

/**
 * One buyer message → the agent's reply, streamed as NDJSON.
 * The conversation is saved before the "done" line, so the state it carries is already up to date.
 */
export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Your help session has ended. Please verify your order again." }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please type a message (up to 2,000 characters)." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: ChatStreamLine) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      try {
        const turn = streamBuyerMessage(session.orderId, parsed.data.message);
        let next = await turn.next();
        while (!next.done) {
          send(next.value);
          next = await turn.next();
        }
        await touchSession(session.id, next.value.caseId);
        send({ type: "done", state: await loadChatState(session) });
      } catch (err) {
        console.error("help/chat failed", err);
        send({ type: "error", message: "Sorry, something went wrong on our side. Please try again in a moment." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
