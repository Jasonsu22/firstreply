import { z } from "zod";
import { streamBuyerMessage, type TurnEvent } from "@/lib/agent/agent";
import { parseDataUrl, validateBuyerImage } from "@/lib/agent/photo";
import { sessionFromRequest, touchSession } from "@/lib/help/session";
import { loadChatState, type ChatState } from "@/lib/help/state";

const Body = z.object({
  message: z.string().trim().max(2000).default(""),
  /** Optional data-URL photo (JPEG/PNG/WebP/GIF, ≤ 4 MB) for damaged / wrong-item flows. */
  imageDataUrl: z.string().max(6_000_000).optional(),
});

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
  if (!parsed.success) return Response.json({ error: "Please type a message or attach a photo (up to 2,000 characters)." }, { status: 400 });

  const text = parsed.data.message.trim();
  let image = undefined as ReturnType<typeof parseDataUrl> extends infer R ? Exclude<R, null> | undefined : never;
  if (parsed.data.imageDataUrl) {
    const parsedImage = parseDataUrl(parsed.data.imageDataUrl);
    if (!parsedImage) {
      return Response.json({ error: "That photo couldn't be read. Please use a JPEG, PNG, WebP or GIF under 4 MB." }, { status: 400 });
    }
    const problem = validateBuyerImage(parsedImage);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    image = parsedImage;
  }
  if (!text && !image) return Response.json({ error: "Please type a message or attach a photo." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: ChatStreamLine) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      try {
        const turn = streamBuyerMessage(session.orderId, text || "I attached a photo of the item.", image);
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
