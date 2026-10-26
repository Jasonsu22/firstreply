/** Money is stored as integer cents (see docs/DATABASE.md). These convert at the edges only. */

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** PayPal wants amounts as decimal strings, e.g. 12900 → "129.00". */
export function centsToPayPal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function payPalToCents(value: string): number {
  return Math.round(Number(value) * 100);
}
