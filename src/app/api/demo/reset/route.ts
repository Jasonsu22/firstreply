import { demoResetAllowed, resetDemoStore } from "@/lib/demo/seed-store";
import { getMerchantSession } from "@/lib/merchant-session";

/**
 * Demo panel: wipe Trailhead and re-seed. Blocked in production unless explicitly enabled, and on a deployed
 * site it also needs a console sign-in — a public URL that wipes the store mid-judging would be a bad surprise.
 */
export async function POST() {
  if (!demoResetAllowed()) {
    return Response.json({ error: "Demo reset is disabled in this environment." }, { status: 403 });
  }
  if (process.env.NODE_ENV === "production" && !(await getMerchantSession())) {
    return Response.json({ error: "Sign in to the merchant console first (one click: “Open the demo store's console”), then reset." }, { status: 401 });
  }
  try {
    const result = await resetDemoStore();
    if ("skipped" in result) {
      return Response.json({ ok: true, skipped: true });
    }
    return Response.json({ ok: true, summary: result });
  } catch (err) {
    console.error("demo/reset failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Reset failed." }, { status: 500 });
  }
}
