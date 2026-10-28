/**
 * Flow B helpers: match what a buyer pastes from their card/bank statement
 * against the single order this help session is already bound to.
 * Pure functions — no DB, no LLM (PLAN.md Flow B).
 */

export type StatementOrder = {
  orderNumber: string;
  amountCents: number;
  currency?: string;
  softDescriptor: string | null;
  placedOn?: string; // YYYY-MM-DD
};

export type StatementMatch = {
  amountMatched: boolean;
  descriptorMatched: boolean;
  orderNumberMentioned: boolean;
  parsedAmountCents: number | null;
  parsedDescriptor: string | null;
  /** True when enough of the paste lines up that we can confidently say "this is your order". */
  likelySameCharge: boolean;
  explanation: string;
};

/** Pull the first dollar amount from free text ("$42.18", "42.18 USD", "USD 42.18"). */
export function parseStatementAmountCents(text: string): number | null {
  const cleaned = text.replace(/,/g, " ");
  const patterns = [
    /\$\s*(\d+(?:\.\d{1,2})?)/,
    /\bUSD\s*(\d+(?:\.\d{1,2})?)/i,
    /(\d+(?:\.\d{1,2})?)\s*USD\b/i,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (!m) continue;
    const dollars = Number(m[1]);
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    return Math.round(dollars * 100);
  }
  return null;
}

/** Normalize soft descriptors / statement labels for comparison. */
export function normalizeDescriptor(value: string): string {
  return value
    .toUpperCase()
    .replace(/^PAYPAL\s*\*/i, "")
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

/**
 * Best-effort descriptor extract: prefers a PAYPAL *… token, else a long ALL-CAPS run.
 * Returns null when nothing looks like a statement label.
 */
export function parseStatementDescriptor(text: string): string | null {
  const paypal = text.match(/PAYPAL\s*\*\s*([A-Z0-9 .\/_-]{3,22})/i);
  if (paypal) return paypal[0].replace(/\s+/g, " ").trim().slice(0, 40);

  const caps = text.match(/\b([A-Z][A-Z0-9 .\/_-]{4,30})\b/);
  if (caps && /[A-Z]{3}/.test(caps[1])) return caps[1].replace(/\s+/g, " ").trim();

  return null;
}

export function matchStatementSnippet(snippet: string, order: StatementOrder): StatementMatch {
  const parsedAmountCents = parseStatementAmountCents(snippet);
  const parsedDescriptor = parseStatementDescriptor(snippet);
  const amountMatched = parsedAmountCents != null && parsedAmountCents === order.amountCents;

  const orderDesc = order.softDescriptor ? normalizeDescriptor(order.softDescriptor) : "";
  const pastedDesc = parsedDescriptor ? normalizeDescriptor(parsedDescriptor) : "";
  const descriptorMatched = Boolean(
    orderDesc &&
      pastedDesc &&
      (pastedDesc.includes(orderDesc) || orderDesc.includes(pastedDesc) || pastedDesc.slice(0, 12) === orderDesc.slice(0, 12)),
  );

  const orderNumberMentioned = snippet.toUpperCase().includes(order.orderNumber.toUpperCase());

  const likelySameCharge = amountMatched && (descriptorMatched || orderNumberMentioned || !order.softDescriptor);

  const parts: string[] = [];
  if (amountMatched) parts.push(`The amount matches this order (${(order.amountCents / 100).toFixed(2)} ${order.currency ?? "USD"}).`);
  else if (parsedAmountCents != null) parts.push(`The pasted amount (${(parsedAmountCents / 100).toFixed(2)}) doesn't match this order's ${(order.amountCents / 100).toFixed(2)}.`);
  else parts.push("No dollar amount found in what was pasted.");

  if (order.softDescriptor) {
    if (descriptorMatched) parts.push(`The statement label looks like this store's descriptor ("${order.softDescriptor}").`);
    else parts.push(`On the statement this store appears as "${order.softDescriptor}".`);
  }
  if (orderNumberMentioned) parts.push(`The order number ${order.orderNumber} appears in the paste.`);

  return {
    amountMatched,
    descriptorMatched,
    orderNumberMentioned,
    parsedAmountCents,
    parsedDescriptor,
    likelySameCharge,
    explanation: parts.join(" "),
  };
}
