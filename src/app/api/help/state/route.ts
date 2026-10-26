import { sessionFromRequest } from "@/lib/help/session";
import { loadChatState } from "@/lib/help/state";

/** The chat window's current state: order, conversation, open offer. Called on load and after each reply. */
export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return Response.json({ error: "Your help session has ended. Please verify your order again." }, { status: 401 });
  return Response.json({ state: await loadChatState(session) });
}
