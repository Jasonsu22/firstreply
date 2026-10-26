import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrderCard } from "@/components/store/order-card";
import { getBuyerSession } from "@/lib/buyer-session";
import { listBuyerOrders } from "@/lib/store";

async function Orders() {
  await connection();
  const buyerId = await getBuyerSession();
  const orders = buyerId ? await listBuyerOrders(buyerId) : [];

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-stone-300 p-8 dark:border-zinc-700">
        <p className="text-zinc-600 dark:text-zinc-400">
          {buyerId ? "You don't have any orders yet." : "Orders you place in this browser show up here."}
        </p>
        <Link href="/store" className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          Start shopping →
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">My orders</h1>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-stone-200/60 dark:bg-zinc-800/60" />}>
        <Orders />
      </Suspense>
    </div>
  );
}
