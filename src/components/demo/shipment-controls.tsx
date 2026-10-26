"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const STATUSES = [
  { value: "shipped", label: "Shipped" },
  { value: "on_hold", label: "Stuck (on hold)" },
  { value: "delivered", label: "Delivered" },
  { value: "lost", label: "Lost" },
] as const;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
}

export function ShipmentControls({ orderId, shipment }: { orderId: string; shipment?: { id: string; status: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run(url: string, body: unknown) {
    setBusy(true);
    setError(undefined);
    try {
      await post(url, body);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {shipment ? (
        <div className="flex flex-wrap justify-end gap-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={busy || shipment.status === s.value}
              onClick={() => run("/api/demo/shipment-status", { shipmentId: shipment.id, status: s.value })}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-default disabled:border-zinc-900 disabled:bg-zinc-900 disabled:text-white dark:border-zinc-700 dark:hover:bg-zinc-800 dark:disabled:border-zinc-100 dark:disabled:bg-zinc-100 dark:disabled:text-zinc-900"
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => run("/api/demo/ship", { orderId })}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {busy ? "Shipping…" : "Ship with UPS"}
        </button>
      )}
      {error && <p className="max-w-xs text-right text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
