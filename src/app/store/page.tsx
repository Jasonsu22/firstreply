import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductArt } from "@/components/store/product-art";
import { formatCents } from "@/lib/money";
import { getDemoMerchant, listProducts } from "@/lib/store";

async function ProductGrid() {
  await connection();
  const merchant = await getDemoMerchant();
  const products = await listProducts(merchant.id);
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <li key={p.id}>
          <Link
            href={`/store/products/${p.id}`}
            className="group flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 transition hover:border-emerald-600 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <ProductArt name={p.name} />
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium group-hover:text-emerald-700 dark:group-hover:text-emerald-400">{p.name}</h2>
              <p className="tabular-nums text-zinc-600 dark:text-zinc-400">{formatCents(p.priceCents, p.currency)}</p>
            </div>
            <p className="line-clamp-2 text-sm text-zinc-500">{p.description}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function GridSkeleton() {
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="h-80 animate-pulse rounded-2xl bg-stone-200/60 dark:bg-zinc-800/60" />
      ))}
    </ul>
  );
}

export default function StorePage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Gear for the trail</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Ships from Portland, OR within one business day.</p>
      </div>
      <Suspense fallback={<GridSkeleton />}>
        <ProductGrid />
      </Suspense>
    </div>
  );
}
