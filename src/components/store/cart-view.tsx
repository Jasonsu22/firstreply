"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { formatCents } from "@/lib/money";
import { useCart } from "./cart";
import { PayPalCheckout } from "./paypal-checkout";
import { ProductArt } from "./product-art";

type CatalogItem = { id: string; name: string; priceCents: number; currency: string };

export function CartView({ catalog, paypalClientId }: { catalog: CatalogItem[]; paypalClientId: string | undefined }) {
  const { lines, ready, setQuantity, remove, clear } = useCart();
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const items = lines.flatMap((l) => {
    const product = byId.get(l.productId);
    return product ? [{ ...l, product }] : [];
  });
  const totalCents = items.reduce((sum, i) => sum + i.product.priceCents * i.quantity, 0);
  const onPaid = useCallback(() => clear(), [clear]);

  if (!ready) return <div className="h-64 animate-pulse rounded-2xl bg-stone-200/60 dark:bg-zinc-800/60" />;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-stone-300 p-8 dark:border-zinc-700">
        <p className="text-zinc-600 dark:text-zinc-400">Your cart is empty.</p>
        <Link href="/store" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          Browse products →
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <ul className="flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {items.map(({ product, quantity }) => (
          <li key={product.id} className="flex items-center gap-4 p-4">
            <ProductArt name={product.name} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col">
              <Link href={`/store/products/${product.id}`} className="truncate font-medium hover:text-emerald-700">
                {product.name}
              </Link>
              <span className="text-sm text-zinc-500 tabular-nums">{formatCents(product.priceCents, product.currency)} each</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`One less ${product.name}`}
                onClick={() => setQuantity(product.id, quantity - 1)}
                className="rounded-md p-1.5 hover:bg-stone-100 dark:hover:bg-zinc-800"
              >
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center tabular-nums">{quantity}</span>
              <button
                type="button"
                aria-label={`One more ${product.name}`}
                onClick={() => setQuantity(product.id, quantity + 1)}
                className="rounded-md p-1.5 hover:bg-stone-100 dark:hover:bg-zinc-800"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <span className="w-20 text-right tabular-nums">{formatCents(product.priceCents * quantity, product.currency)}</span>
            <button
              type="button"
              aria-label={`Remove ${product.name}`}
              onClick={() => remove(product.id)}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-stone-100 hover:text-red-600 dark:hover:bg-zinc-800"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <aside className="flex h-fit flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-baseline justify-between">
          <span className="text-zinc-600 dark:text-zinc-400">Total</span>
          <span className="text-2xl font-semibold tabular-nums">{formatCents(totalCents)}</span>
        </div>
        <p className="text-xs text-zinc-500">Free UPS Ground shipping. Taxes not charged in this demo.</p>
        {paypalClientId ? (
          <PayPalCheckout clientId={paypalClientId} lines={lines} onPaid={onPaid} />
        ) : (
          <p className="text-sm text-red-700">PayPal isn&apos;t configured (missing PAYPAL_CLIENT_ID).</p>
        )}
        <p className="text-xs text-zinc-500">Sandbox: log in with a PayPal sandbox buyer account.</p>
      </aside>
    </div>
  );
}
