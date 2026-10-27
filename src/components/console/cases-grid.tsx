"use client";

/**
 * The merchant's cases grid (AG Grid Community). Custom cell renderers for status, trust tier and the
 * agent's last policy decision; quick search; status chips that filter the rows; rows refresh every
 * few seconds so a case changes in place while the agent is working on it.
 */
import { AllCommunityModule, colorSchemeDark, ModuleRegistry, themeQuartz, type ColDef, type RowClassRules } from "ag-grid-community";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { LoaderCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { approveAction, rejectAction, type DecisionResult } from "@/app/console/actions";
import type { CaseRow } from "@/lib/console/cases";
import { DecisionText, ISSUE_LABEL, RESOLUTION_LABEL, StatusBadge, TierBadge } from "./badges";

ModuleRegistry.registerModules([AllCommunityModule]);

const POLL_MS = 5000;

const baseTheme = themeQuartz.withParams({
  accentColor: "#047857",
  fontFamily: "inherit",
  fontSize: 13,
  headerFontWeight: 600,
  wrapperBorderRadius: 12,
  rowVerticalPaddingScale: 1.1,
});
const lightTheme = baseTheme.withParams({ backgroundColor: "#ffffff", headerBackgroundColor: "#fafafa" });
const darkTheme = baseTheme.withPart(colorSchemeDark).withParams({ backgroundColor: "#18181b", headerBackgroundColor: "#1f1f23" });

function subscribeDark(callback: () => void) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const useDarkMode = () =>
  useSyncExternalStore(
    subscribeDark,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );

const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function duration(minutes: number | null) {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
}

// ── Cell renderers ────────────────────────────────────────────────────────────

const OrderCell = ({ data }: CustomCellRendererProps<CaseRow>) => <span className="font-semibold">{data?.orderNumber}</span>;

const BuyerCell = ({ data }: CustomCellRendererProps<CaseRow>) =>
  data ? (
    <span className="flex flex-col leading-tight">
      <span>{data.buyerName ?? data.buyerEmail}</span>
      {data.buyerName && <span className="text-xs text-zinc-500">{data.buyerEmail}</span>}
    </span>
  ) : null;

const TierCell = ({ data }: CustomCellRendererProps<CaseRow>) =>
  data ? (
    <span title={data.tierAtOpen !== data.buyerTier ? `Was ${data.tierAtOpen.replace("_", " ")} when the case opened` : undefined}>
      <TierBadge tier={data.buyerTier} />
    </span>
  ) : null;

const StatusCell = ({ data }: CustomCellRendererProps<CaseRow>) =>
  data ? (
    <span className="flex items-center gap-1.5">
      <StatusBadge status={data.status} />
      {data.pendingApproval && <span className="size-2 rounded-full bg-amber-500" title="Waiting for your approval" />}
    </span>
  ) : null;

const DecisionCell = ({ data }: CustomCellRendererProps<CaseRow>) => <DecisionText decision={data?.lastDecision ?? null} />;

const OutcomeCell = ({ data }: CustomCellRendererProps<CaseRow>) => {
  if (!data?.resolutionType) return <span className="text-zinc-400">—</span>;
  const amount = data.resolutionAmountCents ? ` · ${money(data.resolutionAmountCents, data.currency)}` : "";
  return (
    <span>
      {RESOLUTION_LABEL[data.resolutionType] ?? data.resolutionType}
      {amount}
    </span>
  );
};

type GridContext = { refresh: () => Promise<void> };

/** Approve / Reject right in the row, with a second click to confirm before money moves. */
function DecideCell({ data, context }: CustomCellRendererProps<CaseRow, unknown, GridContext>) {
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);
  const [result, setResult] = useState<DecisionResult>();
  const [pending, startTransition] = useTransition();
  const approval = data?.approval;
  if (!approval) return result?.ok ? <span className="text-xs text-emerald-700 dark:text-emerald-400">Done</span> : null;

  const run = (fn: () => Promise<DecisionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      setConfirming(null);
      if (r.ok) await context.refresh();
    });

  const btn = "rounded-md px-2 py-0.5 text-xs font-medium disabled:opacity-50";
  return (
    <span className="flex h-full items-center gap-1.5" title={result && !result.ok ? result.error : approval.label}>
      {pending ? (
        <span className="flex items-center gap-1 text-xs text-zinc-500">
          <LoaderCircle className="size-3.5 animate-spin" /> Working…
        </span>
      ) : confirming === "approve" ? (
        <>
          <button className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`} onClick={() => run(() => approveAction(approval.id))}>
            {approval.offerType === "reship" ? "Confirm reship" : `Confirm ${money(approval.atStakeCents, data.currency)}`}
          </button>
          <button className={`${btn} text-zinc-500`} onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </>
      ) : confirming === "reject" ? (
        <>
          <button className={`${btn} bg-red-700 text-white hover:bg-red-800`} onClick={() => run(() => rejectAction(approval.id))}>
            Confirm reject
          </button>
          <button className={`${btn} text-zinc-500`} onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`} onClick={() => setConfirming("approve")}>
            Approve
          </button>
          <button className={`${btn} border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`} onClick={() => setConfirming("reject")}>
            Reject
          </button>
          {result && !result.ok && <span className="truncate text-xs text-red-700 dark:text-red-400">{result.error}</span>}
        </>
      )}
    </span>
  );
}

// ── Grid ──────────────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_you", label: "Needs you" },
  { key: "active", label: "In progress" },
  { key: "resolved", label: "Resolved" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function matchesFilter(row: CaseRow, filter: FilterKey) {
  switch (filter) {
    case "all":
      return true;
    case "needs_you":
      return row.status === "awaiting_merchant" || row.status === "escalated" || row.pendingApproval;
    case "active":
      return row.status === "open" || row.status === "awaiting_buyer";
    case "resolved":
      return row.status === "resolved" || row.status === "closed";
  }
}

const rowClassRules: RowClassRules<CaseRow> = {
  "fr-needs-you": (p) => !!p.data && (p.data.pendingApproval || p.data.status === "awaiting_merchant" || p.data.status === "escalated"),
};

export function CasesGrid({ initialRows }: { initialRows: CaseRow[] }) {
  const router = useRouter();
  const dark = useDarkMode();
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [offline, setOffline] = useState(false);

  // Live updates: re-fetch on an interval (and when the tab comes back into view).
  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/console/cases", { cache: "no-store" });
      if (res.status === 401) return router.push("/console/login");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { rows: CaseRow[] };
      setRows(data.rows);
      setUpdatedAt(new Date());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [router]);

  useEffect(() => {
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter((r) => matchesFilter(r, f.key)).length])) as Record<FilterKey, number>, [rows]);

  const columnDefs = useMemo<ColDef<CaseRow>[]>(
    () => [
      { field: "orderNumber", headerName: "Order", cellRenderer: OrderCell, pinned: "left", width: 120 },
      { colId: "decide", headerName: "Your decision", cellRenderer: DecideCell, width: 230, sortable: false, valueGetter: (p) => p.data?.approval?.id ?? "" },
      { field: "buyerEmail", headerName: "Buyer", cellRenderer: BuyerCell, minWidth: 200, flex: 1, getQuickFilterText: (p) => `${p.data?.buyerName ?? ""} ${p.data?.buyerEmail ?? ""}` },
      { field: "buyerTier", headerName: "Trust tier", cellRenderer: TierCell, width: 125 },
      { field: "issueType", headerName: "Issue", valueFormatter: (p) => ISSUE_LABEL[p.value] ?? p.value, width: 160 },
      { field: "status", headerName: "Status", cellRenderer: StatusCell, width: 165, enableCellChangeFlash: true },
      { field: "lastDecision", headerName: "Agent decision", cellRenderer: DecisionCell, width: 150, enableCellChangeFlash: true },
      { field: "orderAmountCents", headerName: "Order total", type: "rightAligned", valueFormatter: (p) => money(p.value, p.data?.currency), width: 120, cellClass: "tabular-nums" },
      { field: "resolutionType", headerName: "Outcome", cellRenderer: OutcomeCell, width: 170, enableCellChangeFlash: true },
      { field: "messageCount", headerName: "Buyer msgs", type: "rightAligned", width: 110 },
      { field: "openedAt", headerName: "Opened", sort: "desc", valueFormatter: (p) => ago(p.value), width: 115 },
      { field: "lastActivityAt", headerName: "Last activity", valueFormatter: (p) => ago(p.value), width: 125, enableCellChangeFlash: true },
      { field: "minutesToResolve", headerName: "Time to resolve", valueFormatter: (p) => duration(p.value), width: 135, type: "rightAligned" },
    ],
    [],
  );

  const visibleRows = useMemo(() => rows.filter((r) => matchesFilter(r, filter)), [rows, filter]);
  const open = useCallback((id?: string) => id && router.push(`/console/cases/${id}`), [router]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter cases">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                filter === f.key ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {f.label} <span className="ml-0.5 opacity-60 tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, buyer, issue…"
            aria-label="Search cases"
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pr-3 pl-8 text-sm outline-none focus:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-900"
          />
        </label>
      </div>

      <div className="h-[calc(100vh-14rem)] min-h-[420px]">
        <AgGridReact<CaseRow>
          theme={dark ? darkTheme : lightTheme}
          rowData={visibleRows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          quickFilterText={search}
          rowClassRules={rowClassRules}
          context={{ refresh } satisfies GridContext}
          onCellClicked={(e) => e.column.getColId() !== "decide" && open(e.data?.id)}
          onCellKeyDown={(e) => (e.event as KeyboardEvent | undefined)?.key === "Enter" && open(e.data?.id)}
          rowStyle={{ cursor: "pointer" }}
          overlayNoRowsTemplate="No cases yet. When a buyer asks for help, the case shows up here."
        />
      </div>

      <p className="text-xs text-zinc-500" aria-live="polite">
        {offline ? "Can't reach the server — showing the last data." : updatedAt ? `Live · updated ${updatedAt.toLocaleTimeString()}` : "Live · updates every few seconds"}
      </p>
    </div>
  );
}
