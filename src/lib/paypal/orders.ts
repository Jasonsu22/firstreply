/** PayPal Orders v2 calls for the demo store checkout (direct REST: the toolkit can't set a soft descriptor). */
import { centsToPayPal } from "@/lib/money";
import { PayPalError, paypalRequest } from "./client";

export type CheckoutLine = { name: string; sku: string; quantity: number; unitPriceCents: number };

type Money = { currency_code: string; value: string };
type Address = {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_1?: string;
  admin_area_2?: string;
  postal_code?: string;
  country_code?: string;
};

export type PayPalOrder = {
  id: string;
  status: string;
  payer?: { email_address?: string; payer_id?: string; name?: { given_name?: string; surname?: string } };
  purchase_units?: {
    reference_id?: string;
    shipping?: { name?: { full_name?: string }; address?: Address };
    payments?: { captures?: { id: string; status: string; amount: Money }[] };
  }[];
};

export async function createPayPalOrder(args: {
  orderNumber: string;
  localOrderId: string;
  brandName: string;
  softDescriptor: string | null;
  currency: string;
  lines: CheckoutLine[];
}): Promise<PayPalOrder> {
  const totalCents = args.lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  return paypalRequest<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    requestId: `create-${args.localOrderId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: args.orderNumber,
          invoice_id: args.orderNumber,
          custom_id: args.localOrderId,
          description: `${args.brandName} order ${args.orderNumber}`,
          ...(args.softDescriptor && { soft_descriptor: args.softDescriptor }),
          amount: {
            currency_code: args.currency,
            value: centsToPayPal(totalCents),
            breakdown: { item_total: { currency_code: args.currency, value: centsToPayPal(totalCents) } },
          },
          items: args.lines.map((l) => ({
            name: l.name.slice(0, 127),
            sku: l.sku,
            quantity: String(l.quantity),
            unit_amount: { currency_code: args.currency, value: centsToPayPal(l.unitPriceCents) },
            category: "PHYSICAL_GOODS",
          })),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: args.brandName.slice(0, 127),
            shipping_preference: "GET_FROM_FILE",
            user_action: "PAY_NOW",
          },
        },
      },
    },
  });
}

/**
 * Captures an approved order. Safe to call twice: the request id makes PayPal return the
 * first result, and an "already captured" answer falls back to reading the order.
 */
export async function capturePayPalOrder(paypalOrderId: string): Promise<PayPalOrder> {
  try {
    return await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: "POST",
      requestId: `capture-${paypalOrderId}`,
    });
  } catch (err) {
    const issue = err instanceof PayPalError ? (err.body as { details?: { issue?: string }[] })?.details?.[0]?.issue : undefined;
    if (issue === "ORDER_ALREADY_CAPTURED") return paypalRequest<PayPalOrder>(`/v2/checkout/orders/${paypalOrderId}`);
    throw err;
  }
}
