"use client";

/** Shopping cart kept in the browser (localStorage). Prices are never trusted from here — the server re-prices at checkout. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CartLine = { productId: string; quantity: number };

type CartContextValue = {
  lines: CartLine[];
  count: number;
  ready: boolean;
  add: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

const STORAGE_KEY = "firstreply-cart";
const MAX_QUANTITY = 10;
const CartContext = createContext<CartContextValue | null>(null);

function load(): CartLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((l) => typeof l?.productId === "string" && l.quantity > 0) : [];
  } catch {
    return []; // private mode or corrupted value — start empty
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(load()); // eslint-disable-line react-hooks/set-state-in-effect -- read browser storage after hydration
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // storage unavailable — the cart still works for this page view
    }
  }, [lines, ready]);

  const add = useCallback((productId: string, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((l) => l.productId === productId);
      if (!existing) return [...current, { productId, quantity: Math.min(quantity, MAX_QUANTITY) }];
      return current.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(l.quantity + quantity, MAX_QUANTITY) } : l));
    });
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.productId !== productId)
        : current.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(quantity, MAX_QUANTITY) } : l)),
    );
  }, []);

  const remove = useCallback((productId: string) => setLines((current) => current.filter((l) => l.productId !== productId)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(
    () => ({ lines, count: lines.reduce((n, l) => n + l.quantity, 0), ready, add, setQuantity, remove, clear }),
    [lines, ready, add, setQuantity, remove, clear],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}

export function CartCount() {
  const { count, ready } = useCart();
  if (!ready || count === 0) return null;
  return (
    <span className="ml-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">{count}</span>
  );
}
