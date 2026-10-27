import { BarChart3, CheckSquare, Gavel, Inbox, LogOut, MessageSquareReply, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOut } from "@/app/console/actions";
import { requireMerchant } from "@/lib/merchant-session";

const NAV = [
  { href: "/console", label: "Cases", icon: Inbox, ready: true },
  { href: "/console/approvals", label: "Approvals", icon: CheckSquare, ready: true },
  { href: "/console/disputes", label: "Disputes", icon: Gavel, ready: false },
  { href: "/console/policies", label: "Policies", icon: SlidersHorizontal, ready: true },
  { href: "/console/impact", label: "Impact", icon: BarChart3, ready: false },
];

async function Account() {
  await connection();
  const session = await requireMerchant();
  return (
    <div className="flex items-center gap-3 text-sm md:flex-col md:items-start md:gap-1">
      <span className="font-medium">{session.merchantName}</span>
      <span className="hidden text-xs text-zinc-500 md:block">{session.email}</span>
      <form action={signOut} className="ml-auto md:ml-0 md:mt-2">
        <button className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <LogOut className="size-3.5" /> Sign out
        </button>
      </form>
    </div>
  );
}

/** Merchant console shell (PLAN.md §9). Each page also checks the session itself before reading data. */
export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 text-zinc-900 md:flex-row dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="flex flex-col gap-4 border-b border-zinc-200 bg-white px-4 py-4 md:w-56 md:shrink-0 md:border-r md:border-b-0 md:py-6 dark:border-zinc-800 dark:bg-zinc-900">
        <Link href="/console" className="flex items-center gap-2 font-semibold">
          <MessageSquareReply className="size-5 text-emerald-700 dark:text-emerald-400" /> FirstReply
        </Link>
        <nav className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col">
          {NAV.map(({ href, label, icon: Icon, ready }) =>
            ready ? (
              <Link key={href} href={href} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <Icon className="size-4" /> {label}
              </Link>
            ) : (
              <span key={href} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap text-zinc-400" title="Coming in the next build days">
                <Icon className="size-4" /> {label}
              </span>
            ),
          )}
        </nav>
        <div className="md:mt-auto">
          <Suspense fallback={<div className="h-10" />}>
            <Account />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
