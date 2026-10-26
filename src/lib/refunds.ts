/**
 * Refunds, done safely (docs/DATABASE.md §3.5):
 * lock the order → check refunded + amount ≤ amount → insert the refund with its key →
 * call PayPal with that key as PayPal-Request-Id → mark completed and update the order.
 * All in one transaction, so a crash or retry can never refund twice.
 *
 * Uses PayPal REST directly (not the toolkit) because the toolkit's refund call can't
 * send an idempotency key.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, refunds } from "@/db/schema";
import { centsToPayPal } from "@/lib/money";
import { paypalRequest } from "@/lib/paypal/client";

export class RefundError extends Error {}

type PayPalRefund = { id: string; status: "COMPLETED" | "PENDING" | "CANCELLED" | "FAILED"; amount?: { value: string } };

export async function issueRefund(args: { orderId: string; offerId: string | null; amountCents: number; idempotencyKey: string; noteToPayer?: string }) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, args.orderId)).for("update");
    if (!order) throw new RefundError("Order not found.");

    const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, args.idempotencyKey));
    if (existing?.status === "completed") return { refund: existing, alreadyDone: true };

    if (!order.paypalCaptureId) throw new RefundError("Order has no PayPal capture to refund.");
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) throw new RefundError("Refund amount must be positive.");
    if (order.refundedCents + args.amountCents > order.amountCents) {
      throw new RefundError(`Refund would exceed the order total (${order.refundedCents} of ${order.amountCents} cents already refunded).`);
    }

    const [pending] = existing
      ? [existing]
      : await tx
          .insert(refunds)
          .values({ orderId: order.id, offerId: args.offerId, idempotencyKey: args.idempotencyKey, amountCents: args.amountCents })
          .returning();

    const paypal = await paypalRequest<PayPalRefund>(`/v2/payments/captures/${order.paypalCaptureId}/refund`, {
      method: "POST",
      requestId: args.idempotencyKey,
      body: {
        amount: { currency_code: order.currency, value: centsToPayPal(args.amountCents) },
        ...(args.noteToPayer && { note_to_payer: args.noteToPayer.slice(0, 255) }),
      },
    });
    if (paypal.status === "FAILED" || paypal.status === "CANCELLED") throw new RefundError(`PayPal refund ${paypal.status.toLowerCase()}.`);

    const [refund] = await tx
      .update(refunds)
      .set({ status: "completed", paypalRefundId: paypal.id })
      .where(eq(refunds.id, pending.id))
      .returning();
    const refundedCents = order.refundedCents + args.amountCents;
    await tx
      .update(orders)
      .set({ refundedCents, status: refundedCents >= order.amountCents ? "refunded" : "partially_refunded" })
      .where(eq(orders.id, order.id));
    return { refund, paypal, alreadyDone: false };
  });
}
