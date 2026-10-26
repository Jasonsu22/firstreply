import { MessageCircleQuestion } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HelpChat } from "@/components/help/help-chat";
import { getMerchantBySlug } from "@/lib/help/session";

/**
 * Door 4 (PLAN.md §3.0): the merchant's hosted help page, firstreply.app/s/<shop>.
 * The widget (public/widget.js) loads the same page with ?embed=1 inside its iframe.
 */
async function Help({ params, searchParams }: Pick<PageProps<"/s/[shop]">, "params" | "searchParams">) {
  await connection();
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  const merchant = await getMerchantBySlug(shop);
  if (!merchant) notFound();

  const embed = query.embed === "1";
  const link = typeof query.link === "string" ? query.link : undefined;
  const door = query.door === "widget" ? "widget" : query.door === "email_link" || link ? "email_link" : "hosted_page";
  const chat = <HelpChat shop={merchant.slug} storeName={merchant.name} door={door} link={link} />;

  if (embed) return <div className="flex h-dvh flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">{chat}</div>;

  return (
    <div className="flex min-h-dvh flex-col items-center bg-stone-100 px-4 py-8 text-zinc-900 sm:py-14 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex items-center gap-3 border-b border-stone-200 px-5 py-4 dark:border-zinc-800">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-700 text-white">
            <MessageCircleQuestion className="size-5" />
          </span>
          <div>
            <h1 className="font-semibold">{merchant.name}</h1>
            <p className="text-xs text-zinc-500">Order help</p>
          </div>
        </header>
        <div className="flex h-[min(640px,75dvh)] flex-col">{chat}</div>
      </div>
      <p className="mt-4 text-xs text-zinc-500">Powered by FirstReply · PayPal sandbox demo</p>
    </div>
  );
}

export default function HelpPage(props: PageProps<"/s/[shop]">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100 dark:bg-zinc-950" />}>
      <Help params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
