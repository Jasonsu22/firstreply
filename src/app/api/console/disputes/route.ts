import { lastDisputeCheck, listDisputes } from "@/lib/console/disputes";
import { getMerchantSession } from "@/lib/merchant-session";

/** The disputes grid polls this so new disputes appear without a reload. */
export async function GET() {
  const session = await getMerchantSession();
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });
  const [rows, check] = await Promise.all([listDisputes(session.merchantId), lastDisputeCheck(session.merchantId)]);
  return Response.json({ rows, check }, { headers: { "Cache-Control": "no-store" } });
}
