import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { disputeDrafts, disputes } from "@/db/schema";
import { buildEvidencePdf } from "@/lib/disputes/pdf";
import { buildDisputeRecord } from "@/lib/disputes/record";
import { getMerchantSession } from "@/lib/merchant-session";

/** The evidence PDF for a dispute (the latest draft's response), for the merchant to preview before sending. */
export async function GET(_request: Request, { params }: RouteContext<"/api/console/disputes/[id]/evidence">) {
  const session = await getMerchantSession();
  if (!session) return new Response("Not signed in", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [dispute] = await db.select().from(disputes).where(and(eq(disputes.id, id), eq(disputes.merchantId, session.merchantId)));
  if (!dispute) return new Response("Not found", { status: 404 });
  const [draft] = await db.select().from(disputeDrafts).where(eq(disputeDrafts.disputeId, id)).orderBy(desc(disputeDrafts.version)).limit(1);

  const pdf = await buildEvidencePdf(await buildDisputeRecord(id), { responseText: draft?.responseText ?? "(No response drafted yet.)" });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${dispute.paypalDisputeId}-case-record.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
