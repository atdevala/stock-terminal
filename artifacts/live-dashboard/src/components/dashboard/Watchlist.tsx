import { useEffect, useMemo, useState } from "react";
import {
  useGetStocks,
  useGetQuotes,
  useGetScores,
  useGetSignalDeltas,
  getGetQuotesQueryKey,
  getGetScoresQueryKey,
  getGetSignalDeltasQueryKey,
  type StockScore,
  type SignalDelta,
} from "@workspace/api-client-react";
import { StockRow } from "./StockRow";
import { WatchlistMacdInspector } from "./WatchlistMacdInspector";
import { stripEmoji } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { SignalCommandCenter } from "@/components/workstation/SignalCommandCenter";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "accumulation" | "rising" | "superstock" | "divergence" | "latecycle";

function WatchlistMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "teal" | "amber" | "violet";
}) {
  const toneClass = {
    neutral: "text-zinc-100",
    teal: "text-teal-200",
    amber: "text-amber-200",
    violet: "text-violet-200",
  }[tone];

  return (
    <div className="rounded-md border border-zinc-800/80 bg-black/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", toneClass)}>{value}</div>
    </div>
  );
}

const FILTERS: {
  key:    FilterKey;
  label:  string;
  base:   string;
  active: string;
  tip:    { title: string; body: string; how: string };
}[] = [
  {
    key:    "all",
    label:  "All Stocks",
    base:   "border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200",
    active: "bg-zinc-700 border-zinc-500 text-white",
    tip: {
      title: "All Stocks",
      body:  "Shows every stock across all 9 sectors. Use this as your starting view before narrowing down.",
      how:   "Scroll through the categories to get a sector-level picture of where signals are strongest. The sector grouping reveals rotation patterns that a flat list cannot.",
    },
  },
  {
    key:    "accumulation",
    label:  "Institutional Accumulation",
    base:   "border-teal-700 text-teal-500 hover:border-teal-500 hover:text-teal-300",
    active: "bg-teal-900/40 border-teal-500 text-teal-200",
    tip: {
      title: "Institutional Accumulation — ACS ≥ 65",
      body:  "Stocks where the ACS (Accumulation Confidence Score) detects quiet institutional buying — up-volume pressure, price coiling, relative strength vs SPY, and high closing strength. ACS is completely independent of INS and COS, so it catches setups that pure momentum filters miss.",
      how:   "Look at which sectors cluster here. If 3–4 stocks in the same sector all show ACS ≥ 65, that is a sector rotation signal worth acting on. Prioritise names where ACS is rising alongside a high CPE — that combination suggests smart money is positioning ahead of a catalyst.",
    },
  },
  {
    key:    "rising",
    label:  "Momentum Rising",
    base:   "border-violet-700 text-violet-500 hover:border-violet-500 hover:text-violet-300",
    active: "bg-violet-900/40 border-violet-500 text-violet-200",
    tip: {
      title: "Momentum Rising — INS trend accelerating",
      body:  "Stocks where the INS (Inflection Signal Score) trend is currently RISING or STRONGLY RISING based on signal history snapshots. This is a dynamic, directional filter — completely different from a static INS threshold. A stock at INS 55 with a strongly rising trend is often more interesting than one at INS 72 going flat.",
      how:   "Requires at least one 30-minute snapshot to have been saved since the server last restarted. Use alongside the Watchlist tab's score badges — stocks with both a rising INS trend and a positive 1D delta chip are the highest-priority setups here.",
    },
  },
  {
    key:    "superstock",
    label:  "Superstock",
    base:   "border-amber-700 text-amber-500 hover:border-amber-500 hover:text-amber-300",
    active: "bg-amber-900/40 border-amber-500 text-amber-200",
    tip: {
      title: "Superstock — Elite Triple Threshold",
      body:  "Stocks simultaneously above all three elite thresholds: INS ≥ 72, ACS ≥ 68, and FBRS < 28. All three conditions must hold at once — momentum front-running, institutional confirmation, and low false-breakout risk. This filter typically returns 3–7 names across the entire 103-stock watchlist.",
      how:   "If a stock appears here, treat it as the highest-priority setup in the entire watchlist. Scale in deliberately rather than chasing — Superstock status means the setup is already well-developed, not that the move has started. Watch FBRS: if it rises above 28, the Superstock flag drops and the risk profile changes.",
    },
  },
  {
    key:    "divergence",
    label:  "Divergence Events",
    base:   "border-orange-700 text-orange-500 hover:border-orange-600 hover:text-orange-300",
    active: "bg-orange-900/40 border-orange-500 text-orange-200",
    tip: {
      title: "Divergence Events — Active Signal Flags",
      body:  "Stocks with an active divergence flag from the signal history engine: EARLY IGNITION SETUP (INS rising while ACS is quiet — stealth breakout), INSTITUTIONAL ACCUMULATION (ACS leading INS), SPECULATIVE MOMENTUM (INS elevated but ACS weak), or LATE CYCLE / EXHAUSTION RISK (COS high but signals cooling). These are the highest-signal events the system produces.",
      how:   "Divergence flags are time-sensitive. Check the flag label in the stock row tooltip to know which type it is — they have opposite action implications. EARLY IGNITION and INSTITUTIONAL ACCUMULATION are entry signals; LATE CYCLE / EXHAUSTION RISK is an exit warning. Requires snapshot history to have accumulated.",
    },
  },
  {
    key:    "latecycle",
    label:  "Late Cycle Risk",
    base:   "border-red-800 text-red-500 hover:border-red-600 hover:text-red-300",
    active: "bg-red-900/40 border-red-600 text-red-200",
    tip: {
      title: "Late Cycle Risk — Consider Trimming",
      body:  "Stocks labelled LATE STAGE MOVE by the CSOS engine, or where COS is above 78 but INS has dropped below 48 — a pattern where the fundamental/momentum blend looks extended while the leading indicator is fading. This is a risk management view, not a sell signal on its own.",
      how:   "For stocks you hold, use this to identify where risk/reward has deteriorated. Consider taking partial profits or tightening stops. Do not initiate new positions here unless you see a fresh INS re-acceleration. Check back on these names via the Momentum Rising filter to catch any reversal setups.",
    },
  },
];

function matchesFilter(
  score: StockScore | undefined,
  delta: SignalDelta | undefined,
  filter: FilterKey,
): boolean {
  if (filter === "all") return true;
  if (!score) return false;
  switch (filter) {
    case "accumulation":
      return score.acs >= 65;
    case "rising": {
      const t = delta?.trends?.ins;
      return t === "RISING" || t === "STRONGLY_RISING";
    }
    case "superstock":
      return score.isSuperstock === true;
    case "divergence":
      return typeof delta?.divergence === "string" && delta.divergence.trim() !== "";
    case "latecycle":
      return score.signalLabel === "LATE STAGE MOVE" || (score.cos > 78 && (score.ins ?? 0) < 48);
    default:
      return true;
  }
}

export function Watchlist() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const { data: categories, isLoading: isLoadingStocks } = useGetStocks();

  const { data: quotesData } = useGetQuotes({
    query: { refetchInterval: 1500, queryKey: getGetQuotesQueryKey() },
  });

  const { data: scoresData } = useGetScores({
    query: { refetchInterval: 5_000, queryKey: getGetScoresQueryKey() },
  });

  const { data: deltasData } = useGetSignalDeltas({
    query: { refetchInterval: 60_000, queryKey: getGetSignalDeltasQueryKey() },
  });
  const categoryList = categories ?? [];

  const quotesMap = useMemo(
    () => new Map(quotesData?.quotes?.map(q => [q.ticker, q]) ?? []),
    [quotesData?.quotes],
  );

  const scoresMap = useMemo(
    () => new Map(scoresData?.map(s => [s.ticker, s]) ?? []),
    [scoresData],
  );

  const deltasMap = useMemo(
    () => new Map<string, SignalDelta>(deltasData?.map(d => [d.ticker, d]) ?? []),
    [deltasData],
  );

  const flatStocks = useMemo(
    () => categoryList.flatMap(category => category.stocks),
    [categoryList],
  );

  const visibleCategories = useMemo(
    () => categoryList
      .map(category => ({
        category,
        visibleStocks: category.stocks.filter(stock =>
          matchesFilter(scoresMap.get(stock.ticker), deltasMap.get(stock.ticker), activeFilter),
        ),
      }))
      .filter(view => activeFilter === "all" || view.visibleStocks.length > 0),
    [activeFilter, categoryList, deltasMap, scoresMap],
  );

  const visibleStocks = useMemo(
    () => visibleCategories.flatMap(view => view.visibleStocks),
    [visibleCategories],
  );

  useEffect(() => {
    if (visibleStocks.length === 0) {
      setSelectedTicker(null);
      return;
    }

    if (!selectedTicker || !visibleStocks.some(stock => stock.ticker === selectedTicker)) {
      setSelectedTicker(visibleStocks[0]!.ticker);
    }
  }, [selectedTicker, visibleStocks]);

  const matchCount = useMemo(
    () => flatStocks.filter(stock =>
      matchesFilter(scoresMap.get(stock.ticker), deltasMap.get(stock.ticker), activeFilter),
    ).length,
    [activeFilter, deltasMap, flatStocks, scoresMap],
  );

  const accumulationCount = useMemo(
    () => flatStocks.filter(stock => matchesFilter(scoresMap.get(stock.ticker), deltasMap.get(stock.ticker), "accumulation")).length,
    [deltasMap, flatStocks, scoresMap],
  );

  const risingCount = useMemo(
    () => flatStocks.filter(stock => matchesFilter(scoresMap.get(stock.ticker), deltasMap.get(stock.ticker), "rising")).length,
    [deltasMap, flatStocks, scoresMap],
  );

  const superstockCount = useMemo(
    () => flatStocks.filter(stock => matchesFilter(scoresMap.get(stock.ticker), deltasMap.get(stock.ticker), "superstock")).length,
    [deltasMap, flatStocks, scoresMap],
  );

  const selectedStock = useMemo(
    () => flatStocks.find(stock => stock.ticker === selectedTicker) ?? visibleStocks[0],
    [flatStocks, selectedTicker, visibleStocks],
  );

  if (isLoadingStocks || !categories) {
    return (
      <div className="p-6 space-y-8">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">

      {/* ── Filter bar ── */}
      <SignalCommandCenter
        categories={categories}
        quotesMap={quotesMap}
        scoresMap={scoresMap}
        deltasMap={deltasMap}
        activeFilter={activeFilter}
        onSelectFilter={filter => setActiveFilter(filter)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-widest mr-1">Filter:</span>
        {FILTERS.map(f => (
          <Tooltip key={f.key}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveFilter(f.key)}
                className={cn(
                  "text-xs font-medium px-3 py-1 rounded border transition-colors duration-150",
                  activeFilter === f.key ? f.active : f.base,
                )}
              >
                {f.label}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-[300px] p-0 overflow-hidden border border-zinc-700 shadow-2xl rounded-lg z-50"
              style={{ backgroundColor: "#000000" }}
            >
              <div style={{ backgroundColor: "#000000", color: "#ffffff" }}>
                <div className="px-3 py-2 border-b border-zinc-800" style={{ backgroundColor: "#0f0f0f" }}>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-zinc-300 mb-1">{f.tip.title}</div>
                  <div className="text-[11px] text-zinc-400 leading-snug">{f.tip.body}</div>
                </div>
                <div className="px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">How to use</div>
                  <div className="text-[11px] text-zinc-300 leading-snug">{f.tip.how}</div>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
        {activeFilter !== "all" && (
          <span className="text-xs text-muted-foreground ml-2">
            {matchCount} matches
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <WatchlistMetric label="Visible" value={matchCount} />
        <WatchlistMetric label="Accumulation" value={accumulationCount} tone="teal" />
        <WatchlistMetric label="Rising INS" value={risingCount} tone="violet" />
        <WatchlistMetric label="Superstock" value={superstockCount} tone="amber" />
      </div>

      <div className="lg:hidden">
        <WatchlistMacdInspector
          stock={selectedStock}
          quote={selectedStock ? quotesMap.get(selectedStock.ticker) : undefined}
          score={selectedStock ? scoresMap.get(selectedStock.ticker) : undefined}
        />
      </div>

      {/* ── Category tables ── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-10">
        {visibleCategories.map(({ category, visibleStocks }) => {
          return (
            <section key={category.name} className="space-y-4" data-testid={`category-${category.name}`}>
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full shadow-sm"
                  style={{ backgroundColor: `#${category.color}`, boxShadow: `0 0 8px #${category.color}80` }}
                />
                <h2 className="text-lg font-bold tracking-tight text-foreground uppercase">
                  {stripEmoji(category.name)}
                </h2>
                <div className="h-px flex-1 bg-border/50 ml-4" />
              </div>

              <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse table-fixed">
                  <colgroup>
                    <col className="w-auto" />
                    <col className="w-[110px] sm:w-[130px]" />
                    <col className="w-[150px] sm:w-[210px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <th className="py-3 px-4 font-medium">Symbol/Company</th>
                      <th className="py-3 px-4 font-medium text-right">Price</th>
                      <th className="py-3 px-3 font-medium text-left">
                        Signal
                        <span className="block normal-case font-normal text-[9px] text-muted-foreground/70 tracking-normal">
                          tap for VQS/GVS/INS/ACS/FBRS/LQS
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStocks.map(stock => (
                      <StockRow
                        key={stock.ticker}
                        stock={stock}
                        quote={quotesMap.get(stock.ticker)}
                        score={scoresMap.get(stock.ticker)}
                        signalDelta={deltasMap.get(stock.ticker)}
                        isSelected={stock.ticker === selectedTicker}
                        onSelect={setSelectedTicker}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        </div>

        <div className="hidden lg:block">
          <div className="sticky top-6">
            <WatchlistMacdInspector
              stock={selectedStock}
              quote={selectedStock ? quotesMap.get(selectedStock.ticker) : undefined}
              score={selectedStock ? scoresMap.get(selectedStock.ticker) : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
