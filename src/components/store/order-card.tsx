import { Package, Truck } from "lucide-react";
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { createHelpLink } from "@/lib/help/session";
import { DEMO_STORE_SLUG, type BuyerOrder } from "@/lib/store";
import { HelpButton } from "./help-button";
import { ProductArt } from "./product-art";

const SHIPMENT_LABEL: Record<string, { text: string; tone: string }> = {
  shipped: { text: "On its way", tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  on_hold: { text: "Delayed", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" },
  delivered: { text: "Delivered", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  lost: { text: "Lost in transit", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  cancelled: { text: "Shipment cancelled", tone: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function OrderCard({ order, linkToDetail = true }: { order: BuyerOrder; linkToDetail?: boolean }) {
  const shipment = order.shipments[0];
  const label = shipment
    ? SHIPMENT_LABEL[shipment.status]
    : { text: "Preparing to ship", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" };
  const refunded = order.refundedCents > 0;

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-semibold">
          {linkToDetail ? (
            <Link href={`/store/orders/${order.orderNumber}`} className="hover:text-emerald-700">
              Order {order.orderNumber}
            </Link>
          ) : (
            <>Order {order.orderNumber}</>
          )}
        </h2>
        <span className="text-sm text-zinc-500">{dateFormat.format(order.capturedAt ?? order.createdAt)}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${label.tone}`}>{label.text}</span>
        {refunded && (
          <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
            {order.refundedCents >= order.amountCents ? "Refunded" : `${formatCents(order.refundedCents)} refunded`}
          </span>
        )}
        <span className="ml-auto font-medium tabular-nums">{formatCents(order.amountCents, order.currency)}</span>
      </header>

      <ul className="flex flex-col gap-3">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <ProductArt name={item.name} size="sm" />
            <span className="flex-1">
              {item.name}
              {item.quantity > 1 && <span className="text-zinc-500"> × {item.quantity}</span>}
            </span>
            <span className="text-sm text-zinc-500 tabular-nums">{formatCents(item.unitPriceCents * item.quantity, order.currency)}</span>
          </li>
        ))}
      </ul>

      <footer className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4 text-sm dark:border-zinc-800">
        {shipment ? (
          <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <Truck className="size-4" /> {shipment.carrier} {shipment.trackingNumber}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <Package className="size-4" /> Ships within 1 business day
          </span>
        )}
        {/* FirstReply: the widget opens on this order with a signed link — no typing needed. */}
        <HelpButton shop={DEMO_STORE_SLUG} link={createHelpLink(order.id)} />
      </footer>
    </article>
  );
}
