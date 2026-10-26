import { Mountain, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { CartCount, CartProvider } from "@/components/store/cart";

/** The demo store plays "the merchant's own website" (PLAN.md §3.0). */
export default function StoreLayout({ children }: LayoutProps<"/store">) {
  return (
    <CartProvider>
      <div className="flex min-h-full flex-1 flex-col bg-stone-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-stone-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4 sm:px-6">
            <Link href="/store" className="flex items-center gap-2 font-semibold tracking-tight">
              <Mountain className="size-5 text-emerald-700 dark:text-emerald-400" />
              Trailhead Supply Co.
            </Link>
            <div className="ml-auto flex items-center gap-5 text-sm">
              <Link href="/store" className="hover:text-emerald-700 dark:hover:text-emerald-400">
                Shop
              </Link>
              <Link href="/store/orders" className="hover:text-emerald-700 dark:hover:text-emerald-400">
                My orders
              </Link>
              <Link href="/store/cart" className="flex items-center hover:text-emerald-700 dark:hover:text-emerald-400">
                <ShoppingCart className="mr-1 size-4" />
                Cart
                <CartCount />
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-stone-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
          Demo store for FirstReply · PayPal sandbox — no real money moves
        </footer>
      </div>
    </CartProvider>
  );
}
