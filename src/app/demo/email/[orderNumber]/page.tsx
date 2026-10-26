import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db";
import { buyers, orderItems, orders, shipments } from "@/db/schema";
import { createHelpLink } from "@/lib/help/session";
import { formatCents } from "@/lib/money";
import { getDemoMerchant } from "@/lib/store";

/** Door 2 (PLAN.md §3.0): what the merchant's "your order shipped" email looks like with a signed help link. */
async function Email({ params }: Pick<PageProps<"/demo/email/[orderNumber]">, "params">) {
  await connection();
  const { orderNumber } = await params;
  const merchant = await getDemoMerchant();
  const [row] = await db
    .select({ order: orders, buyer: buyers })
    .from(orders)
    .leftJoin(buyers, eq(buyers.id, orders.buyerId))
    .where(and(eq(orders.merchantId, merchant.id), eq(orders.orderNumber, orderNumber)));
  if (!row) notFound();
  const [items, [shipment]] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, row.order.id)),
    db.select().from(shipments).where(eq(shipments.orderId, row.order.id)).orderBy(desc(shipments.shippedAt)).limit(1),
  ]);
  const helpUrl = `/s/${merchant.slug}?door=email_link&link=${encodeURIComponent(createHelpLink(row.order.id))}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
        <div>
          <span className="text-zinc-500">From:</span> {merchant.name} &lt;orders@trailhead.test&gt;
        </div>
        <div>
          <span className="text-zinc-500">To:</span> {row.buyer?.email}
        </div>
        <div>
          <span className="text-zinc-500">Subject:</span> Your order {orderNumber} {shipment ? "is on its way" : "is confirmed"}
        </div>
      </div>
      <article className="flex flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">Hi {row.buyer?.name?.split(" ")[0] ?? "there"}, {shipment ? "your order shipped!" : "thanks for your order!"}</h1>
        <ul className="text-sm">
          {items.map((i) => (
            <li key={i.id}>
              {i.name} × {i.quantity}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Total paid with PayPal: <strong>{formatCents(row.order.amountCents, row.order.currency)}</strong>
        </p>
        {shipment && (
          <p className="text-sm">
            Tracking: {shipment.carrier} {shipment.trackingNumber}
          </p>
        )}
        <div className="rounded-lg bg-emerald-50 p-4 text-sm dark:bg-emerald-950/60">
          <p className="mb-3">Something not right with this order? Talk to us first — we&apos;ll fix it fast.</p>
          <a href={helpUrl} className="inline-block rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800">
            Get help with this order
          </a>
        </div>
      </article>
      <p className="text-xs text-zinc-500">The button carries a signed link for this one order (valid 60 days), so the chat opens already verified.</p>
    </div>
  );
}

export default function EmailPreview(props: PageProps<"/demo/email/[orderNumber]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-10">
      <Link href="/demo" className="text-sm text-zinc-600 hover:text-emerald-700 dark:text-zinc-400">
        ← Demo panel
      </Link>
      <p className="text-sm font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400">Sample order email</p>
      <Suspense fallback={<div className="h-80 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />}>
        <Email params={props.params} />
      </Suspense>
    </main>
  );
}
