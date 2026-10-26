import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrderCard } from "@/components/store/order-card";
import { getBuyerSession } from "@/lib/buyer-session";
import { listBuyerOrders } from "@/lib/store";

async function OrderDetail({ params, searchParams }: Pick<PageProps<"/store/orders/[orderNumber]">, "params" | "searchParams">) {
  await connection();
  const [{ orderNumber }, query, buyerId] = await Promise.all([params, searchParams, getBuyerSession()]);
  // Only the buyer who placed the order can see it (signed cookie); everyone else gets a 404.
  const [order] = buyerId ? await listBuyerOrders(buyerId, orderNumber) : [];
  if (!order) notFound();

  const address = order.shippingAddress;
  return (
    <div className="flex flex-col gap-6">
      {query.placed === "1" && (
        <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-5 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          <CircleCheck className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-medium">Thanks — your order is confirmed.</p>
            <p className="text-sm">Paid with PayPal. We&apos;ll email you when it ships.</p>
          </div>
        </div>
      )}
      <OrderCard order={order} linkToDetail={false} />
      {address && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 font-medium">Shipping to</h2>
          <address className="text-zinc-600 not-italic dark:text-zinc-400">
            {address.name && <div>{address.name}</div>}
            <div>{[address.address_line_1, address.address_line_2].filter(Boolean).join(", ")}</div>
            <div>{[address.admin_area_2, address.admin_area_1, address.postal_code].filter(Boolean).join(", ")}</div>
            <div>{address.country_code}</div>
          </address>
        </section>
      )}
    </div>
  );
}

export default function OrderPage(props: PageProps<"/store/orders/[orderNumber]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/store/orders" className="text-sm text-zinc-600 hover:text-emerald-700 dark:text-zinc-400">
        ← My orders
      </Link>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-stone-200/60 dark:bg-zinc-800/60" />}>
        <OrderDetail params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
