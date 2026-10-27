import { listCases } from "@/lib/console/cases";
import { getMerchantSession } from "@/lib/merchant-session";

/** The cases grid polls this so rows update live while the agent works. */
export async function GET() {
  const session = await getMerchantSession();
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({ rows: await listCases(session.merchantId) }, { headers: { "Cache-Control": "no-store" } });
}
