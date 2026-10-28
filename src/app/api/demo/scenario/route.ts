import { z } from "zod";
import { createScenarioOrder } from "@/lib/demo/scenario";
import { demoResetAllowed } from "@/lib/demo/seed-store";

const Body = z.object({
  kind: z.enum(["stuck_parcel", "delivered_ok"]).default("stuck_parcel"),
});

/** Demo panel: add a local scenario order (no PayPal) for help-chat walkthroughs. */
export async function POST(request: Request) {
  if (!demoResetAllowed()) {
    return Response.json({ error: "Demo scenarios are disabled in this environment." }, { status: 403 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid scenario." }, { status: 400 });
  try {
    const order = await createScenarioOrder(parsed.data.kind);
    return Response.json({ ok: true, order });
  } catch (err) {
    console.error("demo/scenario failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't create the scenario." }, { status: 500 });
  }
}
