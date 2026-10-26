"use client";

import { CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    FirstReply?: { open: (options?: { link?: string }) => void; close: () => void };
  }
}

/** Opens the FirstReply widget already verified for this order (signed link), or the hosted page if the widget isn't loaded. */
export function HelpButton({ shop, link }: { shop: string; link: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.FirstReply) window.FirstReply.open({ link });
        else router.push(`/s/${shop}?door=email_link&link=${encodeURIComponent(link)}`);
      }}
      className="ml-auto inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-3 py-1.5 font-medium text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950"
    >
      <CircleHelp className="size-4" /> Get help with this order
    </button>
  );
}
