"use client";

/**
 * PayPal Smart Buttons (JS SDK v5), loaded straight from PayPal.
 * createOrder → our /api/checkout/create (server prices the cart)
 * onApprove   → our /api/checkout/capture (server captures and saves the order)
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CartLine } from "./cart";

type PayPalButtonsInstance = { render: (el: HTMLElement) => Promise<void>; close: () => Promise<void> };
type PayPalNamespace = {
  Buttons: (options: {
    style?: Record<string, string | number>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError: (err: unknown) => void;
    onCancel?: () => void;
  }) => PayPalButtonsInstance;
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let sdkPromise: Promise<PayPalNamespace> | undefined;

function loadSdk(clientId: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  sdkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK loaded without `paypal`")));
    script.onerror = () => {
      sdkPromise = undefined;
      reject(new Error("Couldn't load PayPal. Check your connection and refresh."));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function PayPalCheckout({ clientId, lines, onPaid }: { clientId: string; lines: CartLine[]; onPaid: () => void }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const linesRef = useRef(lines);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<"loading" | "ready" | "paying">("loading");

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    let buttons: PayPalButtonsInstance | undefined;
    let cancelled = false;

    loadSdk(clientId)
      .then((paypal) => {
        if (cancelled || !container.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "paypal", height: 45 },
          createOrder: async () => {
            setError(undefined);
            const { id } = await postJson<{ id: string }>("/api/checkout/create", { items: linesRef.current });
            return id;
          },
          onApprove: async ({ orderID }) => {
            setStatus("paying");
            try {
              const { orderNumber } = await postJson<{ orderNumber: string }>("/api/checkout/capture", { paypalOrderId: orderID });
              onPaid();
              router.push(`/store/orders/${orderNumber}?placed=1`);
            } catch (err) {
              setStatus("ready");
              setError(err instanceof Error ? err.message : "Payment failed.");
            }
          },
          onError: (err) => {
            setStatus("ready");
            setError(err instanceof Error ? err.message : "PayPal ran into a problem. Please try again.");
          },
        });
        return buttons.render(container.current).then(() => !cancelled && setStatus("ready"));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));

    return () => {
      cancelled = true;
      buttons?.close().catch(() => {});
    };
  }, [clientId, onPaid, router]);

  return (
    <div className="flex flex-col gap-3">
      {status === "loading" && !error && <div className="h-28 animate-pulse rounded-lg bg-stone-200/60 dark:bg-zinc-800/60" />}
      {status === "paying" && <p className="text-sm text-zinc-600 dark:text-zinc-400">Finishing your order…</p>}
      <div ref={container} className={status === "paying" ? "pointer-events-none opacity-50" : undefined} />
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
