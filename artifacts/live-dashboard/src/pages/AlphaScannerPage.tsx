import { useState, useMemo } from "react";
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
  type StockScore,
  type SignalDelta,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip as ReTooltip } from "recharts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatPercent } from "@/lib/formatters";

// ── Types ──────────────────────────────────────────────────────────────────────

type FilterKey = "all" | "fly" | "rising" | "confirmed" | "latecycle";
type SortKey   = "csos" | "ins" | "acs" | "insD1" | "acsD1";

// ── Color helpers ──────────────────────────────────────────────────────────────

function csosColor(s: number): string {
  if (s >= 75) return "text-amber-300";
  if (s >= 55) return "text-amber-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

function csosLabelStyle(label: string): string {
  if (label === "PRIME OPPORTUNITY")    return "text-emerald-300";
  if (label === "EARLY BREAKOUT SETUP") return "text-amber-300";
  if (label === "QUALITY COMPOUNDER")   return "text-sky-300";
  if (label === "CONFIRMED TREND")      return "text-amber-400";
  if (label === "DEVELOPING SETUP")     return "text-zinc-400";
  if (label === "LATE STAGE MOVE")      return "text-orange-400";
  return "text-red-400";
}

function insColor(s: number): string {
  if (s >= 75) return "text-violet-300";
  if (s >= 55) return "text-violet-400/80";
  if (s >= 35) return "text-violet-500/70";
  return "text-zinc-500";
}

function acsColor(s: number): string {
  if (s >= 75) return "text-teal-300";
  if (s >= 55) return "text-teal-400/80";
  if (s >= 35) return "text-teal-500/70";
  return "text-zinc-500";
}

function scoreColor(s: number): string {
  if (s >= 75) return "text-emerald-400";
  if (s >= 55) return "text-yellow-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

// ── Trend arrows ───────────────────────────────────────────────────────────────

const TREND_ARROW: Record<string, string> = {
  STRONGLY_RISING:  "↑↑",
  RISING:           "↑",
  FLAT:             "→",
  FALLING:          "↓",
  STRONGLY_FALLING: "↓↓",
};

const TREND_COLOR: Record<string, string> = {
  STRONGLY_RISING:  "text-emerald-400",
  RISING:           "text-emerald-500/80",
  FLAT:             "text-zinc-500",
  FALLING:          "text-red-500/80",
  STRONGLY_FALLING: "text-red-400",
};

function TrendArrow({ trend }: { trend: string | undefined }) {
  if (!trend) return null;
  return (
    <span className={cn("text-[11px] font-bold leading-none", TREND_COLOR[trend] ?? "text-zinc-500")}>
      {TREND_ARROW[trend] ?? "→"}
    </span>
  );
}

function DeltaChip({ v }: { v: number | null | undefined }) {
  if (v == null) return null;
  if (v === 0)   return <span className="text-[9px] text-zinc-700">±0</span>;
  const pos = v > 0;
  return (
    <span className={cn("text-[9px] font-semibold tabular-nums leading-none", pos ? "text-emerald-400" : "text-red-400")}>
      {pos ? "+" : ""}{v}
      <span className="opacity-50 font-normal"> 1D</span>
    </span>
  );
}

// ── Divergence flag styles ─────────────────────────────────────────────────────

const DIVERGENCE_STYLE: Record<string, string> = {
  "EARLY IGNITION SETUP":                        "bg-violet-900/60 text-violet-200 border-violet-700",
  "SPECULATIVE MOMENTUM (UNCONFIRMED)":           "bg-yellow-900/50 text-yellow-200 border-yellow-700",
  "LATE CYCLE / EXHAUSTION RISK":                 "bg-red-900/50 text-red-200 border-red-800",
  "INSTITUTIONAL ACCUMULATION BEFORE REPRICING":  "bg-teal-900/50 text-teal-200 border-teal-700",
};

// ── Sparkline ──────────────────────────────────────────────────────────────────

function Sparkline({ data, dataKey, color }: {
  data: { ts: number; ins: number; cos: number; acs: number }[];
  dataKey: "ins" | "cos" | "acs";
  color: string;
}) {
  if (data.length < 2) {
    return (
      <div className="w-14 h-6 flex items-center justify-center">
        <span className="text-[9px] text-zinc-700">—</span>
      </div>
    );
  }
  return (
    <div className="w-14 h-6">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 1, bottom: 1, left: 0, right: 0 }}>
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <ReTooltip contentStyle={{ display: "none" }} wrapperStyle={{ display: "none" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Regime Banner ──────────────────────────────────────────────────────────────

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

// ── Row data type ──────────────────────────────────────────────────────────────

interface RowData {
  ticker:        string;
  company:       string;
  categoryColor: string;
  price:         number;
  changePercent: number;
  score:         StockScore;
  delta:         SignalDelta | undefined;
  rank:          number;
}

// ── Filter logic ───────────────────────────────────────────────────────────────

function matchesFilter(row: RowData, filter: FilterKey): boolean {
  const { score, delta } = row;
  const ins   = score.ins ?? 0;
  const cos   = score.cos;
  const label = score.csosLabel ?? "";
  const d1Ins = delta?.delta1D?.ins ?? 0;
  const d1Acs = delta?.delta1D?.acs ?? 0;

  switch (filter) {
    case "fly":       return label === "EARLY BREAKOUT SETUP" || label === "PRIME OPPORTUNITY";
    case "rising":    return d1Ins > 0 || d1Acs > 0;
    case "confirmed": return ins > 65 && cos > 65;
    case "latecycle": return label === "LATE STAGE MOVE" || (cos > 80 && ins < 50);
    default:          return true;
  }
}

// ── Sort logic ─────────────────────────────────────────────────────────────────

function sortRows(rows: RowData[], sortBy: SortKey): RowData[] {
  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "ins":   return (b.score.ins ?? 0) - (a.score.ins ?? 0);
      case "acs":   return b.score.acs - a.score.acs;
      case "insD1": return (b.delta?.delta1D?.ins ?? 0) - (a.delta?.delta1D?.ins ?? 0);
      case "acsD1": return (b.delta?.delta1D?.acs ?? 0) - (a.delta?.delta1D?.acs ?? 0);
      default:      return b.score.csos - a.score.csos;
    }
  });
}

// ── Filter bar config ──────────────────────────────────────────────────────────

const FILTERS: { key: FilterKey; label: string; base: string; active: string }[] = [
  {
    key:    "all",
    label:  "All Stocks",
    base:   "border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200",
    active: "bg-zinc-700 border-zinc-500 text-white",
  },
  {
    key:    "fly",
    label:  "⚡ About to Fly",
    base:   "border-amber-700 text-amber-500 hover:border-amber-500 hover:text-amber-300",
    active: "border-amber-500 bg-amber-900/40 text-amber-200",
  },
  {
    key:    "rising",
    label:  "📈 Rising Signals",
    base:   "border-emerald-700 text-emerald-500 hover:border-emerald-500 hover:text-emerald-300",
    active: "border-emerald-500 bg-emerald-900/40 text-emerald-200",
  },
  {
    key:    "confirmed",
    label:  "✓ Confirmed Move",
    base:   "border-violet-700 text-violet-500 hover:border-violet-500 hover:text-violet-300",
    active: "border-violet-500 bg-violet-900/40 text-violet-200",
  },
  {
    key:    "latecycle",
    label:  "⚠ Late Cycle Risk",
    base:   "border-red-800 text-red-500 hover:border-red-600 hover:text-red-300",
    active: "border-red-600 bg-red-900/40 text-red-200",
  },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "csos",  label: "CSOS"    },
  { key: "ins",   label: "INS"     },
  { key: "acs",   label: "ACS"     },
  { key: "insD1", label: "INS Δ1D" },
  { key: "acsD1", label: "ACS Δ1D" },
];

// ── Main page ──────────────────────────────────────────────────────────────────

export function AlphaScannerPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<SortKey>("csos");

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
        const quote = quotesMap.get(stock.ticker);
        rows.push({
          ticker:        stock.ticker,
          company:       stock.company,
          categoryColor: cat.color,
          price:         quote?.price ?? 0,
          changePercent: quote?.changePercent ?? 0,
          score,
          delta:         deltasMap.get(stock.ticker),
          rank:          0,
        });
      });
    });
    return rows;
  }, [categories, scoresMap, deltasMap, quotesMap]);

  const sorted = useMemo(() => {
    const s = sortRows(allRows, sortBy);
    return s.map((row, i) => ({ ...row, rank: i + 1 }));
  }, [allRows, sortBy]);

  const filtered = useMemo(
    () => sorted.filter(r => matchesFilter(r, filter)),
    [sorted, filter],
  );

  if (loadingStocks) {
    return (
      <div className="flex-1 overflow-auto p-6 space-y-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded" />
        ))}
      </div>
    );
  }

  const hasScores = allRows.length > 0;

  return (
    <div className="flex-1 overflow-auto">

      {/* ── Context panels ── */}
      <div className="px-4 pt-4 pb-3 space-y-2.5">
        <RegimeBanner />
        <SectorRotationPanel />
      </div>

      {/* ── Sticky filter + sort bar ── */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "text-xs font-medium px-3 py-1 rounded border transition-colors duration-150",
                filter === f.key ? f.active : f.base,
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

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
            The Alpha Scanner ranks stocks by CSOS. Scores populate within a few minutes of the server starting.
          </div>
        </div>
      )}

      {/* ── Main ranked table ── */}
      {hasScores && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[820px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800">
                <th className="px-3 py-2.5 text-center w-10">#</th>
                <th className="px-4 py-2.5 text-left min-w-[170px]">Ticker</th>
                <th className="px-3 py-2.5 text-right">Price</th>
                <th className="px-4 py-2.5 text-left min-w-[210px]">
                  <span className="text-amber-500">CSOS</span>
                  <span className="text-zinc-700 ml-1 normal-case font-normal">opportunity score</span>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <span className="text-violet-400">INS</span>
                  <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">trend · 1D</span>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <span className="text-teal-400">ACS</span>
                  <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">trend · 1D</span>
                </th>
                <th className="px-3 py-2.5 text-center hidden lg:table-cell">
                  <span className="text-emerald-500">COS</span>
                  <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">1D</span>
                </th>
                <th className="px-3 py-2.5 text-center hidden lg:table-cell">
                  <span className="text-violet-400/60">INS</span>
                  <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">spark</span>
                </th>
                <th className="px-3 py-2.5 text-left hidden xl:table-cell">Signal Flag</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const { score, delta } = row;
                const ins     = score.ins ?? 0;
                const acs     = score.acs;
                const cos     = score.cos;
                const csos    = score.csos;
                const label   = score.csosLabel ?? "";
                const d1Ins   = delta?.delta1D?.ins ?? null;
                const d1Acs   = delta?.delta1D?.acs ?? null;
                const d1Cos   = delta?.delta1D?.cos ?? null;
                const history = (delta?.history ?? []) as { ts: number; ins: number; cos: number; acs: number }[];
                const divFlag = delta?.divergence;
                const dotColor = `#${row.categoryColor}`;
                const isUp    = row.changePercent >= 0;

                return (
                  <tr
                    key={row.ticker}
                    className={cn(
                      "border-b border-zinc-800/50 hover:bg-zinc-800/25 transition-colors duration-100",
                      idx % 2 === 0 ? "bg-transparent" : "bg-zinc-900/10",
                    )}
                  >
                    {/* Rank */}
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn(
                        "font-bold tabular-nums text-sm",
                        row.rank === 1 ? "text-amber-400" :
                        row.rank <= 3  ? "text-zinc-300"  :
                        row.rank <= 10 ? "text-zinc-400"  : "text-zinc-600",
                      )}>
                        {row.rank}
                      </span>
                    </td>

                    {/* Ticker + company */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="w-2 h-2 rounded-full shrink-0 cursor-help"
                              style={{ backgroundColor: dotColor, boxShadow: `0 0 4px ${dotColor}80` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="text-xs px-2 py-1"
                            style={{ backgroundColor: "#000000", border: "1px solid #27272a" }}
                          >
                            <span style={{ color: dotColor }} className="font-semibold">{score.trendLabel}</span>
                          </TooltipContent>
                        </Tooltip>
                        <span className="font-bold text-sm text-zinc-100">{row.ticker}</span>
                        {score.isSuperstock && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[10px] cursor-help select-none">⭐</span>
                            </TooltipTrigger>
                            <TooltipContent
                              style={{ backgroundColor: "#000000", border: "1px solid #44403c" }}
                              className="text-xs p-2"
                            >
                              <div style={{ color: "#fcd34d" }} className="font-semibold">SUPERSTOCK CANDIDATE</div>
                              <div style={{ color: "#a1a1aa" }} className="text-[10px] mt-0.5">
                                INS ≥ 72 · ACS ≥ 68 · FBRS &lt; 28
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {score.fbrs > 70 && (
                          <span className="text-[8px] font-bold px-1 py-px rounded border bg-red-500/10 text-red-400 border-red-500/30 leading-none">
                            ⚠ HYPE
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate max-w-[160px]">{row.company}</div>
                    </td>

                    {/* Price + change */}
                    <td className="px-3 py-2.5 text-right">
                      <div className="font-mono text-sm text-zinc-200">
                        {row.price > 0 ? `$${row.price.toFixed(2)}` : "—"}
                      </div>
                      <div className={cn("text-[10px] font-mono tabular-nums", isUp ? "text-emerald-400" : "text-red-400")}>
                        {row.price > 0 ? formatPercent(row.changePercent) : ""}
                      </div>
                    </td>

                    {/* CSOS — hero column */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className={cn("font-black text-2xl tabular-nums leading-none", csosColor(csos))}>
                          {csos}
                        </span>
                        <div className="flex flex-col gap-0.5">
                          <span className={cn("text-[9px] font-bold uppercase tracking-wide leading-none", csosLabelStyle(label))}>
                            {label}
                          </span>
                          <span className="text-[9px] text-zinc-600 leading-none tabular-nums">
                            VQS {score.vqs} · GVS {score.gvs}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* INS + trend arrow + 1D delta */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={cn("font-bold text-sm tabular-nums", insColor(ins))}>{ins}</span>
                          <TrendArrow trend={delta?.trends?.ins} />
                        </div>
                        <DeltaChip v={d1Ins} />
                      </div>
                    </td>

                    {/* ACS + trend arrow + 1D delta */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={cn("font-bold text-sm tabular-nums", acsColor(acs))}>{acs}</span>
                          <TrendArrow trend={delta?.trends?.acs} />
                        </div>
                        <DeltaChip v={d1Acs} />
                      </div>
                    </td>

                    {/* COS + 1D delta */}
                    <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={cn("font-bold text-sm tabular-nums", scoreColor(cos))}>{cos}</span>
                        <DeltaChip v={d1Cos} />
                      </div>
                    </td>

                    {/* INS sparkline */}
                    <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                      <Sparkline data={history} dataKey="ins" color="#a78bfa" />
                    </td>

                    {/* Divergence / signal flag */}
                    <td className="px-3 py-2.5 hidden xl:table-cell">
                      {divFlag && DIVERGENCE_STYLE[divFlag] && (
                        <span className={cn(
                          "text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border inline-block leading-tight",
                          DIVERGENCE_STYLE[divFlag],
                        )}>
                          {divFlag}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-zinc-500 text-sm">
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
