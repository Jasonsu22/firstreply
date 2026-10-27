"use client";

/**
 * The buyer's help chat (PLAN.md §3.0, §9). Used full-page at /s/[shop] and inside the widget's iframe.
 * Step 1: verify the order (number + email, or a signed link). Step 2: chat with the agent, with the
 * order on top and Accept / No thanks buttons when there's an offer.
 */
import { ArrowUp, CircleCheck, Clock, LoaderCircle, Lock, Package, Truck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatStreamLine } from "@/app/api/help/chat/route";
import type { ChatBubble, ChatState } from "@/lib/help/state";

type Props = { shop: string; storeName: string; door: "widget" | "hosted_page" | "email_link"; link?: string };

const TOOL_STATUS: Record<string, string> = {
  get_order: "Looking up your order…",
  get_shipment_status: "Checking tracking with the carrier…",
  propose_resolution: "Checking what we can offer…",
  accept_offer: "Setting that up for you…",
  decline_offer: "Noting that…",
  escalate_to_human: "Passing this to the store team…",
};

const QUICK_STARTS = ["My order hasn't arrived", "It arrived damaged", "I got the wrong item", "I don't recognize this charge"];

const SHIPMENT_TEXT: Record<string, string> = {
  shipped: "On its way",
  on_hold: "Delayed",
  delivered: "Delivered",
  lost: "Lost in transit",
  cancelled: "Shipment cancelled",
};

function storageKey(shop: string) {
  return `firstreply:${shop}:session`;
}
function readToken(shop: string) {
  try {
    return sessionStorage.getItem(storageKey(shop)) ?? undefined;
  } catch {
    return undefined;
  }
}
function saveToken(shop: string, token: string | null) {
  try {
    if (token) sessionStorage.setItem(storageKey(shop), token);
    else sessionStorage.removeItem(storageKey(shop));
  } catch {
    // Private mode etc.: the chat still works for this page view.
  }
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function HelpChat({ shop, storeName, door, link }: Props) {
  const [token, setToken] = useState<string>();
  const [state, setState] = useState<ChatState>();
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string>();

  const start = useCallback(
    (data: { token: string; state: ChatState }) => {
      saveToken(shop, data.token);
      setToken(data.token);
      setState(data.state);
      setError(undefined);
    },
    [shop],
  );

  // On load: a signed link wins; otherwise resume this tab's session if there is one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (link) {
          const res = await fetch("/api/help/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link, door: door === "hosted_page" ? "email_link" : door }) });
          const data = await res.json();
          if (cancelled) return;
          if (res.ok) start(data);
          else setError(data.error);
          // Don't leave the link in the address bar (or in screenshots).
          const url = new URL(window.location.href);
          url.searchParams.delete("link");
          window.history.replaceState(null, "", url);
          return;
        }
        const saved = readToken(shop);
        if (!saved) return;
        const res = await fetch("/api/help/state", { headers: { Authorization: `Bearer ${saved}` } });
        if (cancelled) return;
        if (res.ok) start({ token: saved, state: (await res.json()).state });
        else saveToken(shop, null);
      } catch {
        if (!cancelled) setError("We couldn't reach the help service. Please check your connection.");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [link, shop, door, start]);

  const signOut = () => {
    saveToken(shop, null);
    setToken(undefined);
    setState(undefined);
  };

  if (booting) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-zinc-500">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  if (!token || !state) return <VerifyForm shop={shop} storeName={storeName} door={door === "widget" ? "widget" : "hosted_page"} initialError={error} onVerified={start} />;
  return <ChatView token={token} initial={state} onSessionEnded={signOut} />;
}

// ── Step 1: verify ────────────────────────────────────────────────────────────

function VerifyForm({
  shop,
  storeName,
  door,
  initialError,
  onVerified,
}: {
  shop: string;
  storeName: string;
  door: "widget" | "hosted_page";
  initialError?: string;
  onVerified: (data: { token: string; state: ChatState }) => void;
}) {
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/help/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, orderNumber, email, door }),
      });
      const data = await res.json();
      if (res.ok) onVerified(data);
      else setError(data.error);
    } catch {
      setError("We couldn't reach the help service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 dark:border-zinc-700 dark:bg-zinc-950";
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">Problem with an order?</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">We&apos;ll sort it out with you right here — usually in a couple of minutes.</p>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Order number
        <input className={input} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="FR-20001" required autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Email you paid with
        <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" />
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <button
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {busy && <LoaderCircle className="size-4 animate-spin" />} Continue
      </button>
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Lock className="size-3" /> {storeName} order help · you&apos;ll only see this one order
      </p>
    </form>
  );
}

// ── Step 2: chat ──────────────────────────────────────────────────────────────

function ChatView({ token, initial, onSessionEnded }: { token: string; initial: ChatState; onSessionEnded: () => void }) {
  const [state, setState] = useState(initial);
  const [bubbles, setBubbles] = useState<ChatBubble[]>(initial.messages);
  const [streaming, setStreaming] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [bubbles, streaming, status, state.offer]);

  // While the store team is reviewing a fix, check back so their decision shows up without a reload.
  const waitingOnStore = !!state.pendingApproval;
  useEffect(() => {
    if (!waitingOnStore || busy) return;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const res = await fetch("/api/help/state", { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (!res?.ok) return;
      const next = (await res.json()).state as ChatState;
      setState(next);
      setBubbles(next.messages);
    }, 8000);
    return () => clearInterval(timer);
  }, [waitingOnStore, busy, token]);

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(undefined);
    setDraft("");
    setBubbles((b) => [...b, { role: "buyer", text }]);
    setStreaming("");
    setStatus("Reading your message…");

    try {
      const res = await fetch("/api/help/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text }),
      });
      if (res.status === 401) return onSessionEnded();
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let reply = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw) continue;
          const line = JSON.parse(raw) as ChatStreamLine;
          if (line.type === "text") {
            reply += line.text;
            setStreaming(reply);
            setStatus(undefined);
          } else if (line.type === "tool") {
            // A new step starts after a tool: keep earlier text, separated like the saved bubbles.
            if (reply && !reply.endsWith("\n\n")) reply += "\n\n";
            setStatus(TOOL_STATUS[line.name] ?? "Working on it…");
          } else if (line.type === "done") {
            setState(line.state);
            setBubbles(line.state.messages);
          } else if (line.type === "error") {
            setError(line.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setStreaming(undefined);
      setStatus(undefined);
      setBusy(false);
    }
  }

  const { order } = state;
  const shipmentText = order.shipment ? SHIPMENT_TEXT[order.shipment.status] : "Preparing to ship";
  const resolved = state.caseStatus === "resolved" || state.caseStatus === "closed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Order card: the buyer always sees which order this is about. */}
      <div className="border-b border-stone-200 bg-stone-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Order {order.orderNumber}</span>
          <button type="button" onClick={onSessionEnded} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">
            Different order?
          </button>
          <span className="ml-auto font-medium tabular-nums">{money(order.amountCents, order.currency)}</span>
        </div>
        <div className="mt-1 truncate text-zinc-600 dark:text-zinc-400">{order.items.map((i) => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)).join(", ")}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            {order.shipment ? <Truck className="size-3.5" /> : <Package className="size-3.5" />} {shipmentText}
          </span>
          {order.refundedCents > 0 && <span className="text-violet-700 dark:text-violet-300">{money(order.refundedCents, order.currency)} refunded</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
        <Bubble role="agent" text={`Hi! I'm the order assistant for ${state.store.name.replace(/\.$/, "")}. What's going on with this order?`} />
        {bubbles.length === 0 && !busy && (
          <div className="flex flex-wrap gap-2">
            {QUICK_STARTS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="rounded-full border border-emerald-700/40 px-3 py-1 text-sm text-emerald-800 hover:bg-emerald-50 dark:border-emerald-400/40 dark:text-emerald-300 dark:hover:bg-emerald-950"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {bubbles.map((b, i) => (
          <Bubble key={i} role={b.role} text={b.text} />
        ))}
        {streaming && <Bubble role="agent" text={streaming.trimEnd()} />}
        {status && (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <LoaderCircle className="size-4 animate-spin" /> {status}
          </p>
        )}

        {state.offer && !busy && (
          <div className="rounded-xl border border-emerald-700/30 bg-emerald-50 p-3 dark:border-emerald-400/30 dark:bg-emerald-950/60">
            <p className="text-xs font-medium tracking-wide text-emerald-800 uppercase dark:text-emerald-300">Offer</p>
            <p className="font-medium">{state.offer.label}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => send(`Yes, please go ahead with the ${state.offer!.label.toLowerCase()}.`)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
                Yes, go ahead
              </button>
              <button
                onClick={() => send(`No thanks, I don't want the ${state.offer!.label.toLowerCase()}.`)}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                No thanks
              </button>
            </div>
          </div>
        )}
        {state.pendingApproval && !busy && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            <Clock className="mt-0.5 size-4 shrink-0" />
            <span>
              The store team is reviewing: {state.pendingApproval.label.toLowerCase()}. You&apos;ll hear back by{" "}
              {new Date(state.pendingApproval.dueAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.
            </span>
          </p>
        )}
        {resolved && !busy && (
          <p className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
            <CircleCheck className="size-4" /> Resolved. Message us again any time if something else comes up.
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">{error}</p>}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex items-end gap-2 border-t border-stone-200 p-3 dark:border-zinc-800"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Type your message…"
          aria-label="Your message"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          disabled={busy || !draft.trim()}
          aria-label="Send"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  );
}

function Bubble({ role, text }: ChatBubble) {
  return (
    <div
      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
        role === "buyer" ? "self-end rounded-br-md bg-emerald-700 text-white" : "self-start rounded-bl-md bg-stone-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
      }`}
    >
      {text}
    </div>
  );
}
