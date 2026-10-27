"use client";

/**
 * Disputes grid (AG Grid). Every PayPal dispute on the store, matched to its order and case:
 * stage, status, the seller's deadline as a countdown, what PayPal lets the seller do now, and whether
 * the buyer talked to the store first (the core of the evidence). Refreshes every 15 seconds.
 */
import type { ColDef } from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { addDisputeAction, checkDisputesNowAction, type DecisionResult } from "@/app/console/actions";
import type { DisputeRow } from "@/lib/console/disputes";
import { disputeReasonLabel, humanStatus } from "@/lib/disputes/map";
import { darkTheme, lightTheme, useDarkMode } from "./grid-theme";

const POLL_MS = 15_000;
const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

const STAGE_TONE: Record<string, string> = {
  inquiry: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  chargeback: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  pre_arbitration: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  arbitration: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};
const STAGE_LABEL: Record<string, string> = { inquiry: "Inquiry", chargeback: "Claim", pre_arbitration: "Pre-arbitration", arbitration: "Arbitration" };

const ACTION_LABEL: Record<string, string> = {
  send_message: "Message",
  make_offer: "Offer",
  provide_evidence: "Evidence",
  provide_supporting_info: "Supporting info",
  accept_claim: "Accept",
  escalate: "Escalate",
  acknowledge_return_item: "Ack return",
  appeal: "Appeal",
};

const OUTCOME: Record<string, { label: string; tone: string }> = {
  won_by_seller: { label: "Won", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  won_by_buyer: { label: "Lost", tone: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  settled: { label: "Settled", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  cancelled: { label: "Cancelled by buyer", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
};

function countdown(iso: string | null) {
  if (!iso) return { text: "—", urgent: false };
  const hours = (new Date(iso).getTime() - Date.now()) / 3600_000;
  if (hours < 0) return { text: "Passed", urgent: true };
  if (hours < 48) return { text: `${Math.ceil(hours)} h left`, urgent: true };
  return { text: `${Math.floor(hours / 24)} days left`, urgent: false };
}

const IdCell = ({ data }: CustomCellRendererProps<DisputeRow>) => <span className="font-mono text-xs">{data?.paypalDisputeId}</span>;

const OrderCell = ({ data }: CustomCellRendererProps<DisputeRow>) =>
  data?.orderNumber ? (
    data.caseId ? (
      <Link href={`/console/cases/${data.caseId}`} className="font-semibold hover:text-emerald-700">
        {data.orderNumber}
      </Link>
    ) : (
      <span className="font-semibold">{data.orderNumber}</span>
    )
  ) : (
    <span className="text-xs text-zinc-500" title="The disputed payment isn't an order from this store (e.g. an earlier sandbox test).">
      No matching order
    </span>
  );

const StageCell = ({ data }: CustomCellRendererProps<DisputeRow>) => (data ? <span className={`${pill} ${STAGE_TONE[data.stage] ?? ""}`}>{STAGE_LABEL[data.stage] ?? data.stage}</span> : null);

const DueCell = ({ data }: CustomCellRendererProps<DisputeRow>) => {
  if (!data) return null;
  if (data.outcome) return <span className="text-zinc-400">—</span>;
  const c = countdown(data.sellerResponseDueAt);
  return <span className={c.urgent ? "font-medium text-red-700 dark:text-red-400" : ""}>{c.text}</span>;
};

const ActionsCell = ({ data }: CustomCellRendererProps<DisputeRow>) =>
  data?.allowedActions.length ? (
    <span className="flex flex-wrap gap-1">
      {data.allowedActions.map((a) => (
        <span key={a} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {ACTION_LABEL[a] ?? a}
        </span>
      ))}
    </span>
  ) : (
    <span className="text-xs text-zinc-400">None — PayPal is reviewing</span>
  );

const FirstCell = ({ data }: CustomCellRendererProps<DisputeRow>) =>
  data?.contactedFirst ? (
    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Yes — chatted first</span>
  ) : (
    <span className="text-xs text-zinc-500">No</span>
  );

const OutcomeCell = ({ data }: CustomCellRendererProps<DisputeRow>) => {
  if (!data?.outcome) return <span className="text-xs text-zinc-500">Open</span>;
  const o = OUTCOME[data.outcome];
  return <span className={`${pill} ${o?.tone ?? ""}`}>{o?.label ?? data.outcome}</span>;
};

export function DisputesGrid({ initialRows, initialCheck }: { initialRows: DisputeRow[]; initialCheck: { lastPolledAt: string | null; lastError: string | null } | null }) {
  const router = useRouter();
  const dark = useDarkMode();
  const [rows, setRows] = useState(initialRows);
  const [check, setCheck] = useState(initialCheck);
  const [disputeId, setDisputeId] = useState("");
  const [result, setResult] = useState<DecisionResult>();
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    const res = await fetch("/api/console/disputes", { cache: "no-store" }).catch(() => null);
    if (res?.status === 401) return router.push("/console/login");
    if (!res?.ok) return;
    const data = (await res.json()) as { rows: DisputeRow[]; check: typeof initialCheck };
    setRows(data.rows);
    setCheck(data.check);
  }, [router]);

  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = (fn: () => Promise<DecisionResult>) =>
    startTransition(async () => {
      setResult(await fn());
      await refresh();
    });

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (disputeId.trim()) run(() => addDisputeAction(disputeId));
  };

  const columnDefs = useMemo<ColDef<DisputeRow>[]>(
    () => [
      { field: "paypalDisputeId", headerName: "Dispute", cellRenderer: IdCell, pinned: "left", width: 175 },
      { field: "orderNumber", headerName: "Order", cellRenderer: OrderCell, width: 150 },
      { field: "buyerEmail", headerName: "Buyer", minWidth: 180, flex: 1 },
      { field: "reason", headerName: "Reason", valueFormatter: (p) => disputeReasonLabel(p.value), width: 165 },
      { field: "stage", headerName: "Stage", cellRenderer: StageCell, width: 130, enableCellChangeFlash: true },
      { field: "status", headerName: "PayPal status", valueFormatter: (p) => humanStatus(p.value), width: 210, enableCellChangeFlash: true },
      { field: "amountCents", headerName: "Amount", type: "rightAligned", valueFormatter: (p) => money(p.value, p.data?.currency), width: 105, cellClass: "tabular-nums" },
      { field: "sellerResponseDueAt", headerName: "Respond by", cellRenderer: DueCell, width: 120, comparator: (a, b) => (a ?? "9").localeCompare(b ?? "9") },
      { field: "allowedActions", headerName: "You can", cellRenderer: ActionsCell, width: 210, sortable: false, autoHeight: true, wrapText: true },
      { field: "contactedFirst", headerName: "Talked to us first?", cellRenderer: FirstCell, width: 160 },
      { field: "outcome", headerName: "Outcome", cellRenderer: OutcomeCell, width: 130, enableCellChangeFlash: true },
      { field: "openedAt", headerName: "Opened", sort: "desc", valueFormatter: (p) => new Date(p.value).toLocaleDateString("en-US", { month: "short", day: "numeric" }), width: 105 },
    ],
    [],
  );

  const lastChecked = check?.lastPolledAt ? new Date(check.lastPolledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "never";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => run(checkDisputesNowAction)}
          disabled={pending}
          className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Check PayPal now
        </button>
        <span className="text-xs text-zinc-500">
          Last checked {lastChecked}
          {check?.lastError ? ` · last error: ${check.lastError}` : ""}
        </span>
        <form onSubmit={add} className="ml-auto flex w-full gap-2 sm:w-auto">
          <input
            value={disputeId}
            onChange={(e) => setDisputeId(e.target.value)}
            placeholder="PP-R-ABC-12345678"
            aria-label="PayPal dispute ID"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-mono text-sm outline-none focus:border-emerald-600 sm:w-52 dark:border-zinc-800 dark:bg-zinc-900"
          />
          <button disabled={pending || !disputeId.trim()} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-emerald-800 disabled:opacity-50">
            Add by ID
          </button>
        </form>
      </div>
      {result && (
        <p className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"}`}>
          {result.ok ? result.message : result.error}
        </p>
      )}
      <div className="h-[calc(100vh-16rem)] min-h-[360px]">
        <AgGridReact<DisputeRow>
          theme={dark ? darkTheme : lightTheme}
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          onCellClicked={(e) => e.data?.caseId && e.column.getColId() !== "orderNumber" && router.push(`/console/cases/${e.data.caseId}`)}
          overlayNoRowsTemplate="No disputes. That's the goal."
        />
      </div>
    </div>
  );
}
