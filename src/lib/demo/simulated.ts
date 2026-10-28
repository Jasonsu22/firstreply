/**
 * Demo scenario orders (created from the demo panel without a checkout) carry DEMO- PayPal IDs.
 * There is no real PayPal payment behind them, so PayPal calls are skipped and the store's own
 * records are used instead; money moves on them are recorded as SIMULATED- and labelled that way.
 * Seeded history orders have no PayPal IDs at all and stay blocked by the policy (NOT_A_PAYPAL_PAYMENT).
 */
export const SIMULATED_PREFIX = "DEMO-";
export const SIMULATED_REFUND_PREFIX = "SIMULATED-";

export function isSimulatedPayment(order: { paypalCaptureId: string | null }): boolean {
  return !!order.paypalCaptureId?.startsWith(SIMULATED_PREFIX);
}

export function isSimulatedRefundId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(SIMULATED_REFUND_PREFIX);
}
