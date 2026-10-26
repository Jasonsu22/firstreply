/**
 * Minimal PayPal REST client for the calls the Agent Toolkit doesn't cover
 * (orders with a soft descriptor, dispute evidence, offers, messages).
 * Sandbox only — this project never talks to live PayPal.
 */
import { randomUUID } from "node:crypto";

export const PAYPAL_API = "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const b = body as { name?: string; message?: string; debug_id?: string; details?: unknown };
    super(`PayPal ${status} ${b?.name ?? ""}: ${b?.message ?? JSON.stringify(body)} (debug_id ${b?.debug_id ?? "n/a"})`);
  }
}

function credentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env");
  return { clientId, clientSecret };
}

type Token = { access_token: string; scope: string; expires_at: number };
let cachedToken: Token | undefined;

export async function getAccessToken(): Promise<Token> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) return cachedToken;
  const { clientId, clientSecret } = credentials();
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError(res.status, body);
  cachedToken = { access_token: body.access_token, scope: body.scope, expires_at: Date.now() + body.expires_in * 1000 };
  return cachedToken;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Sent as PayPal-Request-Id so a retried money call can never run twice. */
  requestId?: string;
};

export async function paypalRequest<T = unknown>(path: string, { method = "GET", body, requestId }: RequestOptions = {}): Promise<T> {
  const { access_token } = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${access_token}` };
  let payload: BodyInit | undefined;

  if (body instanceof FormData) {
    payload = body; // fetch sets the multipart boundary itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET") headers["PayPal-Request-Id"] = requestId ?? randomUUID();

  const res = await fetch(`${PAYPAL_API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new PayPalError(res.status, json);
  return json as T;
}
