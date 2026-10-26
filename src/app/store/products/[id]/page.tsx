import { ArrowLeft, RotateCcw, Truck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AddToCart } from "@/components/store/add-to-cart";
import { ProductArt } from "@/components/store/product-art";
import { formatCents } from "@/lib/money";
import { getDemoMerchant, getProduct } from "@/lib/store";

async function ProductDetail({ params }: { params: PageProps<"/store/products/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const merchant = await getDemoMerchant();
  const product = await getProduct(merchant.id, id);
  if (!product) notFound();

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <ProductArt name={product.name} size="lg" />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{product.name}</h1>
          <p className="text-2xl tabular-nums">{formatCents(product.priceCents, product.currency)}</p>
        </div>
        <p className="text-zinc-600 dark:text-zinc-400">{product.description}</p>
        <AddToCart productId={product.id} />
        <ul className="mt-2 flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li className="flex items-center gap-2">
            <Truck className="size-4" /> UPS Ground, usually 3–5 business days
          </li>
          <li className="flex items-center gap-2">
            <RotateCcw className="size-4" /> 30-day returns, unused and in original packaging
          </li>
        </ul>
      </div>
    </div>
  );
}

export default function ProductPage(props: PageProps<"/store/products/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/store" className="flex items-center gap-1 text-sm text-zinc-600 hover:text-emerald-700 dark:text-zinc-400">
        <ArrowLeft className="size-4" /> All products
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-stone-200/60 dark:bg-zinc-800/60" />}>
        <ProductDetail params={props.params} />
      </Suspense>
    </div>
  );
}
