"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type LastScenario = {
  orderNumber: string;
  buyerEmail: string;
  shipmentStatus: string;
  helpPath: string;
};

async function postJson(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function DemoActions({ resetAllowed }: { resetAllowed: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"reset" | "stuck" | "delivered" | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [last, setLast] = useState<LastScenario>();

  async function run(kind: "reset" | "stuck" | "delivered", fn: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    setMessage(undefined);
    try {
      await fn();
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-5 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div>
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Scenarios &amp; reset</h2>
        <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/70">
          Add a local order (no PayPal checkout) to walk the help chat, or wipe the demo store back to seed data.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run("stuck", async () => {
              const data = await postJson("/api/demo/scenario", { kind: "stuck_parcel" });
              setLast(data.order);
              setMessage(`Created ${data.order.orderNumber} — tracker is stuck on hold. Open help with ${data.order.buyerEmail}.`);
            })
          }
          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {busy === "stuck" ? "Creating…" : "Add stuck parcel"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run("delivered", async () => {
              const data = await postJson("/api/demo/scenario", { kind: "delivered_ok" });
              setLast(data.order);
              setMessage(`Created ${data.order.orderNumber} — marked delivered. Good for unrecognized-charge demos.`);
            })
          }
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          {busy === "delivered" ? "Creating…" : "Add delivered order"}
        </button>
        {resetAllowed && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              if (!confirm("Reset the Trailhead demo store? Sandbox PayPal orders stay in PayPal; local cases, chats and seeded history are wiped and re-seeded.")) return;
              void run("reset", async () => {
                const data = await postJson("/api/demo/reset");
                setLast(undefined);
                setMessage(data.skipped ? "Database already had data — seed skipped." : "Demo store reset and re-seeded.");
              });
            }}
            className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            {busy === "reset" ? "Resetting…" : "Reset demo data"}
          </button>
        )}
      </div>

      {message && <p className="text-sm text-emerald-800 dark:text-emerald-300">{message}</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      {last && (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Latest scenario: <span className="font-medium">{last.orderNumber}</span> · {last.buyerEmail} · tracker {last.shipmentStatus} ·{" "}
          <Link href={last.helpPath} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            Open help →
          </Link>
        </p>
      )}
    </div>
  );
}

export function DemoQuickLinks() {
  const links = [
    { href: "/store", label: "Storefront" },
    { href: "/s/trailhead", label: "Help page" },
    { href: "/console", label: "Merchant console" },
    { href: "/console/impact", label: "Impact" },
    { href: "/store/orders", label: "My orders" },
  ];
  return (
    <nav className="flex flex-wrap gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-emerald-300 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-emerald-700 dark:hover:text-emerald-300"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
