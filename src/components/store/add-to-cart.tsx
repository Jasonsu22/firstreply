"use client";

import { Check, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCart } from "./cart";

export function AddToCart({ productId }: { productId: string }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => {
          add(productId);
          setAdded(true);
        }}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        {added ? <Check className="size-4" /> : <ShoppingCart className="size-4" />}
        {added ? "Added — add another" : "Add to cart"}
      </button>
      {added && (
        <Link href="/store/cart" className="font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400">
          Go to cart →
        </Link>
      )}
    </div>
  );
}
