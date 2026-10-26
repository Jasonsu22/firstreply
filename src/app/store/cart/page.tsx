import { connection } from "next/server";
import { Suspense } from "react";
import { CartView } from "@/components/store/cart-view";
import { getDemoMerchant, listProducts } from "@/lib/store";

async function Cart() {
  await connection();
  const merchant = await getDemoMerchant();
  const products = await listProducts(merchant.id);
  const catalog = products.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, currency: p.currency }));
  // The client ID is public by design — PayPal's JS SDK needs it in the browser. The secret never leaves the server.
  return <CartView catalog={catalog} paypalClientId={process.env.PAYPAL_CLIENT_ID} />;
}

export default function CartPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Your cart</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-stone-200/60 dark:bg-zinc-800/60" />}>
        <Cart />
      </Suspense>
    </div>
  );
}
