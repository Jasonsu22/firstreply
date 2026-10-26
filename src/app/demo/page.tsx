import { desc, eq, inArray, ne, and } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db";
import { buyers, orders, shipments } from "@/db/schema";
import { ShipmentControls } from "@/components/demo/shipment-controls";
import { formatCents } from "@/lib/money";
import { getDemoMerchant } from "@/lib/store";

/** Demo control panel: plays the carrier, since sandbox parcels never move. */
async function OrdersTable() {
  await connection();
  const merchant = await getDemoMerchant();
  const rows = await db
    .select({ order: orders, buyer: buyers })
    .from(orders)
    .leftJoin(buyers, eq(buyers.id, orders.buyerId))
    .where(and(eq(orders.merchantId, merchant.id), ne(orders.status, "created")))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  const ships = rows.length
    ? await db.select().from(shipments).where(inArray(shipments.orderId, rows.map((r) => r.order.id))).orderBy(desc(shipments.shippedAt))
    : [];

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500 uppercase dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-2 font-medium">Order</th>
            <th className="px-4 py-2 font-medium">Buyer</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2 font-medium">Tracking</th>
            <th className="px-4 py-2 text-right font-medium">Carrier status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map(({ order, buyer }) => {
            const shipment = ships.find((s) => s.orderId === order.id);
            const isSandbox = Boolean(order.paypalCaptureId);
            return (
              <tr key={order.id}>
                <td className="px-4 py-3 font-medium whitespace-nowrap">
                  {order.orderNumber}
                  {!isSandbox && <span className="ml-2 text-xs font-normal text-zinc-400">seeded</span>}
                </td>
                <td className="px-4 py-3">
                  <div>{buyer?.name ?? "—"}</div>
                  <div className="text-xs text-zinc-500">{buyer?.email}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(order.amountCents, order.currency)}
                  {order.refundedCents > 0 && <div className="text-xs text-violet-600">−{formatCents(order.refundedCents)} refunded</div>}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                  {shipment ? `${shipment.carrier} ${shipment.trackingNumber}` : "—"}
                </td>
                <td className="px-4 py-3">
                  {isSandbox ? (
                    <ShipmentControls orderId={order.id} shipment={shipment && { id: shipment.id, status: shipment.status }} />
                  ) : (
                    <p className="text-right text-xs text-zinc-400">history only</p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DemoPanel() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400">Demo control panel</p>
        <h1 className="text-3xl font-semibold tracking-tight">Play the carrier</h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
          PayPal sandbox parcels never move, so set each order&apos;s tracking status here. Changes update the order&apos;s
          tracker in PayPal, which is what the agent reads.
        </p>
      </header>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />}>
        <OrdersTable />
      </Suspense>
    </main>
  );
}
