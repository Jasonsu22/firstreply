import { demoResetAllowed, resetDemoStore } from "@/lib/demo/seed-store";

/** Demo panel: wipe Trailhead and re-seed. Blocked in production unless explicitly enabled. */
export async function POST() {
  if (!demoResetAllowed()) {
    return Response.json({ error: "Demo reset is disabled in this environment." }, { status: 403 });
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
