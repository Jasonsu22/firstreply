import { eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { fetchDispute, upsertDispute } from "@/lib/disputes/sync";
import { paypalRequest } from "@/lib/paypal/client";
import { getDemoMerchant } from "@/lib/store";

type WebhookEvent = { id?: string; event_type?: string; resource?: { dispute_id?: string } };

const SIGNATURE_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

/** Asks PayPal whether this webhook really came from PayPal (needs PAYPAL_WEBHOOK_ID). */
async function verifySignature(request: Request, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || SIGNATURE_HEADERS.some((h) => !request.headers.get(h))) return false;
  try {
    const result = (await paypalRequest("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: {
        auth_algo: request.headers.get("paypal-auth-algo"),
        cert_url: request.headers.get("paypal-cert-url"),
        transmission_id: request.headers.get("paypal-transmission-id"),
        transmission_sig: request.headers.get("paypal-transmission-sig"),
        transmission_time: request.headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      },
    })) as { verification_status?: string };
    return result.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/**
 * PayPal webhooks (dispute events). The payload is never trusted: we only take the dispute ID from it and
 * fetch the dispute from PayPal ourselves, so a forged call can at most trigger a re-check.
 */
export async function POST(request: Request) {
  const event = (await request.json().catch(() => null)) as WebhookEvent | null;
  if (!event?.id || !event.event_type) return Response.json({ error: "Not a PayPal webhook event" }, { status: 400 });

  const verified = await verifySignature(request, event);
  if (process.env.PAYPAL_WEBHOOK_ID && !verified) return Response.json({ error: "Signature check failed" }, { status: 401 });

  const [inserted] = await db
    .insert(webhookEvents)
    .values({ paypalEventId: event.id, eventType: event.event_type, payload: event, signatureVerified: verified })
    .onConflictDoNothing()
    .returning();
  // PayPal retries: skip events we've already processed, but try again ones that failed last time.
  const row = inserted ?? (await db.select().from(webhookEvents).where(eq(webhookEvents.paypalEventId, event.id)))[0];
  if (row.processedAt) return Response.json({ ok: true, duplicate: true });

  try {
    const disputeId = event.resource?.dispute_id;
    if (event.event_type.startsWith("CUSTOMER.DISPUTE.") && disputeId) {
      const merchant = await getDemoMerchant();
      await upsertDispute(merchant.id, await fetchDispute(disputeId), "webhook");
    }
    await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, row.id));
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(webhookEvents).set({ error: message }).where(eq(webhookEvents.id, row.id));
    // 500 makes PayPal retry later; the poller would catch it anyway.
    return Response.json({ error: "Couldn't process the event yet" }, { status: 500 });
  }
}
