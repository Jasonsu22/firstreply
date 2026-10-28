import { count, eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db";
import { buyers, merchants, products } from "@/db/schema";

const doors = [
  { name: "Website widget", detail: "One script tag on the store" },
  { name: "Order emails", detail: "Signed, one-click help links" },
  { name: "Card statement", detail: "Help link in the soft descriptor" },
  { name: "Hosted help page", detail: "For sellers without a site" },
];

async function DemoStoreStatus() {
  await connection(); // read the database on each request, not at build time
  const [store] = await db.select().from(merchants).where(eq(merchants.slug, "trailhead"));
  if (!store) {
    return <p className="text-sm text-zinc-500">No demo store yet — run <code>npm run db:seed</code>.</p>;
  }
  const [[productCount], [buyerCount]] = await Promise.all([
    db.select({ n: count() }).from(products).where(eq(products.merchantId, store.id)),
    db.select({ n: count() }).from(buyers).where(eq(buyers.merchantId, store.id)),
  ]);
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      Demo store <span className="font-medium text-zinc-900 dark:text-zinc-100">{store.name}</span> is connected —{" "}
      {productCount.n} products, {buyerCount.n} buyers, PayPal {store.paypalEnv}.
    </p>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-16 sm:px-6">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
          PayPal AI Hackathon 2026
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">FirstReply</h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          The merchant answers before the bank does. An AI agent that resolves order problems through PayPal in minutes —
          and builds the evidence if a dispute happens anyway.
        </p>
      </header>

      <nav className="flex flex-wrap gap-3">
        <Link href="/store" className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800">
          Open the demo store
        </Link>
        <Link href="/s/trailhead" className="rounded-lg border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
          Order help
        </Link>
        <Link href="/console" className="rounded-lg border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
          Merchant console
        </Link>
        <Link href="/console/impact" className="rounded-lg border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
          Impact
        </Link>
        <Link href="/demo" className="rounded-lg border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
          Demo panel
        </Link>
      </nav>

      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <Suspense fallback={<p className="text-sm text-zinc-500">Checking the demo store…</p>}>
          <DemoStoreStatus />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">Where buyers reach the merchant</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {doors.map((d) => (
            <li key={d.name} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">{d.name}</p>
              <p className="text-sm text-zinc-500">{d.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
