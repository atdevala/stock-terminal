import { useState, useMemo, type FormEvent } from "react";
import {
  useGetStocks,
  useGetScores,
  useGetSignalDeltas,
  useGetQuotes,
  useGetMarketRegime,
  useGetSectors,
  getGetScoresQueryKey,
  getGetSignalDeltasQueryKey,
  getGetQuotesQueryKey,
  getGetMarketRegimeQueryKey,
  getGetSectorsQueryKey,
  type Quote,
  type StockInfo,
  type StockScore,
  type SignalDelta,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StockRow } from "@/components/dashboard/StockRow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Types ──────────────────────────────────────────────────────────────────────

type FilterKey = "all" | "accumulate" | "watch" | "caution" | "avoid" | "prebreakout";
type SortKey   = "signal" | "rsi";

// ── Regime banner ────────────────────────────────────────────────────────────

function regimeBannerStyle(regime: string): string {
  if (regime === "RISK-ON MOMENTUM")           return "border-emerald-500/40 bg-emerald-900/15 text-emerald-300";
  if (regime === "QUALITY GROWTH")             return "border-blue-500/40 bg-blue-900/15 text-blue-300";
  if (regime === "HIGH VOLATILITY / UNSTABLE") return "border-red-500/40 bg-red-900/15 text-red-300";
  if (regime === "DEFENSIVE MARKET")           return "border-orange-500/40 bg-orange-900/15 text-orange-300";
  return "border-zinc-700/40 bg-zinc-900/30 text-zinc-400";
}

function regimeIcon(regime: string): string {
  if (regime === "RISK-ON MOMENTUM")           return "🚀";
  if (regime === "QUALITY GROWTH")             return "📈";
  if (regime === "HIGH VOLATILITY / UNSTABLE") return "⚠️";
  if (regime === "DEFENSIVE MARKET")           return "🛡️";
  return "•";
}

function regimeContext(regime: string): string {
  if (regime === "RISK-ON MOMENTUM")           return "Breakout setups favored — momentum buying rewarded";
  if (regime === "QUALITY GROWTH")             return "Quality compounders outperform — selective environment";
  if (regime === "HIGH VOLATILITY / UNSTABLE") return "Caution — unstable regime, raise conviction bar";
  if (regime === "DEFENSIVE MARKET")           return "Avoid new breakouts — market under distribution";
  return "Mixed signals — proceed selectively";
}

function RegimeBanner() {
  const { data: regime } = useGetMarketRegime({
    query: { queryKey: getGetMarketRegimeQueryKey(), refetchInterval: 60_000 },
  });
  if (!regime || regime.regime === "UNKNOWN") return null;
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2 rounded-lg border text-sm font-medium", regimeBannerStyle(regime.regime))}>
      <span className="text-base shrink-0">{regimeIcon(regime.regime)}</span>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold uppercase tracking-wide text-xs">{regime.regime}</span>
        <span className="text-[10px] opacity-60 font-normal">
          SPY 5D: {regime.spyRet5d > 0 ? "+" : ""}{regime.spyRet5d}%
          {" · "}
          SPY 20D: {regime.spyRet20d > 0 ? "+" : ""}{regime.spyRet20d}%
          {" · "}
          Vol: {regime.spyVolatility}%
        </span>
      </div>
      <div className="ml-auto text-[10px] opacity-50 font-normal shrink-0 hidden sm:block">
        {regimeContext(regime.regime)}
      </div>
    </div>
  );
}

// ── Sector Rotation Panel ──────────────────────────────────────────────────────

function stripEmoji(s: string): string {
  return s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim();
}

function SectorRotationPanel() {
  const { data: sectors } = useGetSectors({
    query: { queryKey: getGetSectorsQueryKey(), refetchInterval: 30_000 },
  });
  if (!sectors || sectors.length === 0) return null;
  const top = sectors.slice(0, 5);
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border/40 bg-muted/10">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">🔥 Hot Sectors</span>
        <span className="text-[9px] text-zinc-700">avg INS · ACS · COS</span>
      </div>
      <div className="flex items-stretch divide-x divide-border/30 overflow-x-auto">
        {top.map((sec, i) => {
          const dotColor = sec.color ? `#${sec.color}` : "#71717a";
          return (
            <div key={sec.name} className="flex-1 min-w-[90px] px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                <span className="text-[9px] font-bold uppercase tracking-wide text-zinc-400 truncate">
                  {i + 1}. {stripEmoji(sec.name)}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="text-center">
                  <div className="text-[8px] text-zinc-600 mb-px">INS</div>
                  <div className={cn("text-xs font-bold tabular-nums",
                    sec.avgIns >= 65 ? "text-violet-300" : sec.avgIns >= 50 ? "text-violet-400/70" : "text-zinc-500"
                  )}>{sec.avgIns}</div>
                </div>
                <div className="text-center">
                  <div className="text-[8px] text-zinc-600 mb-px">ACS</div>
                  <div className={cn("text-xs font-bold tabular-nums",
                    sec.avgAcs >= 65 ? "text-teal-300" : sec.avgAcs >= 50 ? "text-teal-500/70" : "text-zinc-500"
                  )}>{sec.avgAcs}</div>
                </div>
                <div className="text-center">
                  <div className="text-[8px] text-zinc-600 mb-px">COS</div>
                  <div className={cn("text-xs font-bold tabular-nums",
                    sec.avgCos >= 65 ? "text-emerald-400" : sec.avgCos >= 50 ? "text-yellow-500" : "text-zinc-500"
                  )}>{sec.avgCos}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Row data ───────────────────────────────────────────────────────────────────

interface RowData {
  ticker:        string;
  company:       string;
  categoryColor: string;
  quote:         Quote | undefined;
  score:         StockScore;
  delta:         SignalDelta | undefined;
  rank:          number;
  onDemand?:     boolean;
}

type SymbolScanState = "idle" | "loading" | "success" | "error";

type SymbolScanSuccess = {
  ok: true;
  source: "on-demand";
  cached: boolean;
  result: {
    ticker: string;
    company: string;
    score: StockScore;
    quote: Pick<Quote, "ticker" | "price" | "changePercent">;
    scannedAt: number;
  };
};

// ── Filter logic — driven entirely by the single composite signal ────────────

const PRE_BREAKOUT_LABELS = new Set(["STEALTH ACCUMULATION", "HIDDEN CATALYST POTENTIAL"]);
const AVOID_LABELS = new Set(["LATE STAGE MOVE", "LOW QUALITY / AVOID"]);

function matchesFilter(row: RowData, filter: FilterKey): boolean {
  const { signalScore, signalLabel, fbrs } = row.score;
  if (filter === "all") return true;
  if (filter === "prebreakout") return PRE_BREAKOUT_LABELS.has(signalLabel);
  if (filter === "caution") return fbrs > 70;
  if (AVOID_LABELS.has(signalLabel)) return filter === "avoid";
  switch (filter) {
    case "accumulate": return signalScore >= 65 && fbrs <= 70;
    case "watch":      return signalScore >= 45 && signalScore < 65 && fbrs <= 70;
    case "avoid":      return signalScore < 45;
    default:           return true;
  }
}

function sortRows(rows: RowData[], sortBy: SortKey): RowData[] {
  return [...rows].sort((a, b) => {
    if (sortBy === "rsi") return (a.score.rsi ?? 50) - (b.score.rsi ?? 50); // most oversold first
    return b.score.signalScore - a.score.signalScore;
  });
}

// ── Filter bar config ──────────────────────────────────────────────────────────

const FILTERS: {
  key:   FilterKey;
  label: string;
  base:  string;
  active: string;
  tip:   { title: string; body: string };
}[] = [
  {
    key: "all", label: "All Stocks",
    base: "border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200",
    active: "bg-zinc-700 border-zinc-500 text-white",
    tip: { title: "All Stocks", body: "Every stock in the scanner, ranked by its composite score." },
  },
  {
    key: "accumulate", label: "Accumulate",
    base: "border-amber-700 text-amber-500 hover:border-amber-500 hover:text-amber-300",
    active: "border-amber-500 bg-amber-900/40 text-amber-200",
    tip: { title: "Accumulate", body: "Composite score ≥ 65 with clean setups (FBRS ≤ 70). The system's actionable buy zone." },
  },
  {
    key: "watch", label: "Watch",
    base: "border-sky-700 text-sky-500 hover:border-sky-500 hover:text-sky-300",
    active: "border-sky-500 bg-sky-900/40 text-sky-200",
    tip: { title: "Watch", body: "Composite score 45–64 — developing, not yet actionable. Track for acceleration." },
  },
  {
    key: "caution", label: "Caution",
    base: "border-orange-700 text-orange-500 hover:border-orange-600 hover:text-orange-300",
    active: "border-orange-500 bg-orange-900/40 text-orange-200",
    tip: { title: "Caution", body: "FBRS above 70 — elevated false-breakout risk regardless of the composite score." },
  },
  {
    key: "avoid", label: "Avoid",
    base: "border-red-800 text-red-500 hover:border-red-600 hover:text-red-300",
    active: "border-red-600 bg-red-900/40 text-red-200",
    tip: { title: "Avoid", body: "Composite score below 45, or labeled LATE STAGE MOVE / LOW QUALITY — no edge or exit signal." },
  },
  {
    key: "prebreakout", label: "Pre-Breakout",
    base: "border-violet-700 text-violet-400 hover:border-violet-500 hover:text-violet-200",
    active: "border-violet-500 bg-violet-900/40 text-violet-200",
    tip: { title: "Pre-Breakout", body: "STEALTH ACCUMULATION or HIDDEN CATALYST POTENTIAL — setups building before the market has priced them in." },
  },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "signal", label: "Best Setup" },
  { key: "rsi",    label: "Most Oversold" },
];

// ── Main page ──────────────────────────────────────────────────────────────────

export function AlphaScannerPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<SortKey>("signal");
  const [searchTicker, setSearchTicker] = useState("");
  const [scanStatus, setScanStatus] = useState<SymbolScanState>("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [onDemandScan, setOnDemandScan] = useState<SymbolScanSuccess | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const { data: categories, isLoading: loadingStocks } = useGetStocks();

  const { data: scoresData } = useGetScores({
    query: { queryKey: getGetScoresQueryKey(), refetchInterval: 5_000 },
  });
  const { data: deltasData } = useGetSignalDeltas({
    query: { queryKey: getGetSignalDeltasQueryKey(), refetchInterval: 60_000 },
  });
  const { data: quotesData } = useGetQuotes({
    query: { queryKey: getGetQuotesQueryKey(), refetchInterval: 3_000 },
  });

  const scoresMap = useMemo(
    () => new Map(scoresData?.map(s => [s.ticker, s]) ?? []),
    [scoresData],
  );
  const deltasMap = useMemo(
    () => new Map(deltasData?.map(d => [d.ticker, d]) ?? []),
    [deltasData],
  );
  const quotesMap = useMemo(
    () => new Map(quotesData?.quotes?.map(q => [q.ticker, q]) ?? []),
    [quotesData],
  );

  const allRows = useMemo<RowData[]>(() => {
    if (!categories) return [];
    const rows: RowData[] = [];
    categories.forEach(cat => {
      cat.stocks.forEach(stock => {
        const score = scoresMap.get(stock.ticker);
        if (!score) return;
        rows.push({
          ticker:        stock.ticker,
          company:       stock.company,
          categoryColor: cat.color,
          quote:         quotesMap.get(stock.ticker),
          score,
          delta:         deltasMap.get(stock.ticker),
          rank:          0,
        });
      });
    });
    return rows;
  }, [categories, scoresMap, deltasMap, quotesMap]);

  const onDemandRow = useMemo<RowData | undefined>(() => {
    if (!onDemandScan) return undefined;
    const { result } = onDemandScan;
    const liveQuote = quotesMap.get(result.ticker);
    const quote: Quote = liveQuote ?? {
      ticker: result.ticker,
      price: result.quote.price,
      change: 0,
      changePercent: result.quote.changePercent,
      prevClose: result.quote.price,
      high: result.quote.price,
      low: result.quote.price,
      open: result.quote.price,
      lastUpdated: result.scannedAt,
    };
    return {
      ticker: result.ticker,
      company: result.company,
      categoryColor: "f59e0b",
      quote,
      score: result.score,
      delta: deltasMap.get(result.ticker),
      rank: 0,
      onDemand: true,
    };
  }, [deltasMap, onDemandScan, quotesMap]);

  const sorted = useMemo(() => {
    const rows = onDemandRow
      ? allRows.filter(row => row.ticker !== onDemandRow.ticker)
      : allRows;
    const s = sortRows(rows, sortBy).map((row, i) => ({
      ...row,
      rank: onDemandRow ? i + 2 : i + 1,
    }));
    return onDemandRow
      ? [{ ...onDemandRow, rank: 1 }, ...s]
      : s;
  }, [allRows, onDemandRow, sortBy]);

  const filtered = useMemo(
    () => sorted.filter(r => r.onDemand || matchesFilter(r, filter)),
    [sorted, filter],
  );

  async function handleSymbolScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticker = searchTicker.trim().toUpperCase();
    if (!ticker) {
      setScanStatus("error");
      setScanMessage("Enter a ticker symbol first.");
      return;
    }

    setSearchTicker(ticker);
    setScanStatus("loading");
    setScanMessage(`Scanning ${ticker}...`);

    try {
      const response = await fetch("/api/scanner/symbol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error ?? `Could not scan ${ticker}.`);
      }

      setOnDemandScan(payload as SymbolScanSuccess);
      setFilter("all");
      setScanStatus("success");
      setScanMessage(`${ticker} pinned at the top${payload.cached ? " from cache" : ""}.`);
    } catch (err) {
      setScanStatus("error");
      setScanMessage(err instanceof Error ? err.message : `Could not scan ${ticker}.`);
    }
  }

  if (loadingStocks) {
    return (
      <div className="flex-1 overflow-auto p-6 space-y-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded" />
        ))}
      </div>
    );
  }

  const hasScores = allRows.length > 0 || Boolean(onDemandRow);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">

      {/* ── Context panels ── */}
      <form
        onSubmit={handleSymbolScan}
        className="rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300">
              Scan any U.S. ticker
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Search one American stock on demand. The broad scanner stays curated to avoid free-plan rate limits.
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={searchTicker}
              onChange={event => setSearchTicker(event.target.value.toUpperCase())}
              placeholder="AAPL, PLTR, SMCI..."
              className="h-9 w-full rounded border border-zinc-800 bg-black px-3 font-mono text-sm uppercase text-zinc-100 outline-none transition-colors placeholder:text-zinc-700 focus:border-amber-500/70 sm:w-52"
              maxLength={15}
              aria-label="Ticker symbol"
            />
            <button
              type="submit"
              disabled={scanStatus === "loading"}
              className={cn(
                "h-9 rounded border px-4 text-xs font-semibold uppercase tracking-wide transition-colors",
                scanStatus === "loading"
                  ? "border-zinc-800 bg-zinc-900 text-zinc-600"
                  : "border-amber-500/60 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25",
              )}
            >
              {scanStatus === "loading" ? "Scanning" : "Scan"}
            </button>
          </div>
        </div>
        {scanMessage && (
          <div className={cn(
            "mt-2 text-xs",
            scanStatus === "error" ? "text-red-300" :
            scanStatus === "success" ? "text-emerald-300" : "text-zinc-500",
          )}>
            {scanMessage}
          </div>
        )}
      </form>
      <RegimeBanner />
      <SectorRotationPanel />

      {/* ── Filter + sort bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-widest mr-1">Filter:</span>
        {FILTERS.map(f => (
          <Tooltip key={f.key}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setFilter(f.key)}
                className={cn(
                  "text-xs font-medium px-3 py-1 rounded border transition-colors duration-150",
                  filter === f.key ? f.active : f.base,
                )}
              >
                {f.label}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-[280px] p-2 border border-zinc-700 shadow-2xl rounded-lg z-50"
              style={{ backgroundColor: "#000000" }}
            >
              <div className="text-[10px] uppercase tracking-widest font-bold text-zinc-300 mb-1">{f.tip.title}</div>
              <div className="text-[11px] text-zinc-400 leading-snug">{f.tip.body}</div>
            </TooltipContent>
          </Tooltip>
        ))}
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Sort</span>
          {SORT_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => setSortBy(o.key)}
              className={cn(
                "text-[10px] font-medium px-2 py-0.5 rounded transition-colors",
                sortBy === o.key
                  ? "bg-amber-800/60 text-amber-200"
                  : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300",
              )}
            >
              {o.label}
            </button>
          ))}
          <span className="ml-1 text-[10px] text-zinc-600">{filtered.length} stocks</span>
        </div>
      </div>

      {/* ── Empty / loading state ── */}
      {!hasScores && (
        <div className="flex flex-col items-center justify-center gap-4 text-center px-8 py-20">
          <div className="text-3xl">⚡</div>
          <div className="text-base font-semibold text-zinc-300">Scores are loading</div>
          <div className="text-sm text-zinc-500 max-w-sm">
            The Scanner ranks stocks by their composite setup score. Scores populate within a few minutes of the server starting.
          </div>
        </div>
      )}

      {/* ── Main ranked table — same row design as Your List ── */}
      {hasScores && (
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
                  Setup
                  <span className="block normal-case font-normal text-[9px] text-muted-foreground/70 tracking-normal">
                    tap for VQS/GVS/INS/ACS/FBRS/LQS
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <StockRow
                  key={row.ticker}
                  stock={{ ticker: row.ticker, company: row.company, focus: "", risk: "" } as StockInfo}
                  quote={row.quote}
                  score={row.score}
                  signalDelta={row.delta}
                  isSelected={row.ticker === selectedTicker}
                  onSelect={setSelectedTicker}
                  rank={row.rank}
                  sectorColor={`#${row.categoryColor}`}
                  onDemand={row.onDemand}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center py-12 text-zinc-500 text-sm">
                    No stocks match this filter right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
