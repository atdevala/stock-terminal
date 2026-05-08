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

// ── Column header tooltip helpers ─────────────────────────────────────────────

function ColHeader({ children, tip, align = "center" }: {
  children: React.ReactNode;
  tip: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`cursor-help underline decoration-dotted decoration-zinc-700 underline-offset-2 inline-flex items-center gap-0.5 ${align === "left" ? "justify-start" : "justify-center"}`}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[340px] p-0 overflow-hidden border border-zinc-700 shadow-2xl rounded-lg text-left z-50"
        style={{ backgroundColor: "#000000" }}
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

function TipBody({ title, color, desc, levels }: {
  title: string;
  color: string;
  desc: string;
  levels: [string, string][];
}) {
  return (
    <div style={{ backgroundColor: "#000000", color: "#ffffff" }}>
      <div className="px-3 py-2.5 border-b border-zinc-800" style={{ backgroundColor: "#0f0f0f" }}>
        <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color }}>{title}</div>
        <div className="text-[11px] text-zinc-300 leading-snug">{desc}</div>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {levels.map(([band, meaning]) => (
          <div key={band} className="flex items-start gap-2.5 text-[10px]">
            <span className="font-mono text-zinc-500 shrink-0 w-[72px] leading-snug">{band}</span>
            <span className="text-zinc-300 leading-snug">{meaning}</span>
          </div>
        ))}
      </div>
    </div>
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
            The Scanner ranks stocks by CSOS. Scores populate within a few minutes of the server starting.
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

                {/* CSOS */}
                <th className="px-4 py-2.5 text-left min-w-[210px]">
                  <ColHeader align="left" tip={
                    <TipBody
                      title="CSOS — Composite Signal Opportunity Score"
                      color="#f59e0b"
                      desc="Blends VQS (fundamentals), INS (breakout signal), ACS (accumulation), and COS (momentum) into a single ranked number. The label is context-aware — it reflects the signal pattern, not just the raw score. Sort by CSOS to rank all 103 stocks by overall opportunity."
                      levels={[
                        ["PRIME OPP.", "All signals co-elevated — INS, ACS, and COS all >70 with strong VQS. Rare and highest-conviction. When this appears, it means multiple independent signals are pointing the same direction at once."],
                        ["EARLY BRK.", "INS >75 leading COS by a wide margin. The signal is front-running the crowd — this is where early entries are found before the move becomes consensus."],
                        ["QUALITY", "VQS ≥65 is the dominant driver. Strong business with durable fundamentals. Not yet in a breakout — watch INS for the right entry timing."],
                        ["CONFIRMED", "COS and INS both elevated with ACS support. The move has started and is confirmed. Still actionable but you are no longer getting in early."],
                        ["DEVELOPING", "Signals building but not yet converged. Monitor for INS or ACS acceleration before committing capital."],
                        ["LATE STAGE", "COS is extended but INS is fading. Risk/reward is deteriorating — the easy money has been made. Size down or wait for a full reset."],
                        ["LOW QUALITY", "VQS <40 fundamental override. Weak business quality negates price action. Do not chase regardless of momentum."],
                      ]}
                    />
                  }>
                    <span className="text-amber-500">CSOS</span>
                    <span className="text-zinc-700 ml-1 normal-case font-normal">opportunity score</span>
                  </ColHeader>
                </th>

                {/* INS */}
                <th className="px-3 py-2.5 text-center">
                  <ColHeader tip={
                    <TipBody
                      title="INS — Inflection Signal Score"
                      color="#a78bfa"
                      desc="The leading breakout indicator — detects early momentum shifts before they appear in price or in the consensus score (COS). Measures: Δ GVS momentum, Δ VQS quality trend, volume acceleration, EPS estimate slope, and narrative momentum. INS typically leads COS by 2–6 weeks on genuine breakouts. A stock where INS is rising while COS is flat is a pre-consensus setup — highest risk, highest reward."
                      levels={[
                        ["≥ 75", "Strong breakout signal. High-conviction pre-consensus entry window. The signal is leading and not yet priced in."],
                        ["≥ 55", "Momentum building. Watch closely for INS acceleration toward the 75 threshold — that crossing is the key event."],
                        ["≥ 35", "Weak or early signal. Low conviction — monitor only, do not commit capital yet."],
                        ["< 35",  "No signal. Avoid until INS recovers. Chasing here typically results in buying right before a flat period."],
                        ["↑↑ trend", "Strongly rising — 6+ point swing across recent snapshots. Momentum is accelerating, not just drifting."],
                        ["↑ trend",  "Rising — 2–5 point movement. Healthy direction, watch for continuation."],
                        ["→ trend",  "Flat — within ±1 pt. No directional conviction right now."],
                        ["↓ / ↓↓",  "Falling or sharply falling. Momentum fading — existing positions may need review."],
                        ["+N 1D Δ",  "INS gained N points since the last snapshot. Accelerating 1D delta = early signal building in real time. The 'INS Δ1D' sort puts the fastest-moving setups at the top of the list."],
                      ]}
                    />
                  }>
                    <span className="text-violet-400">INS</span>
                    <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">trend · 1D</span>
                  </ColHeader>
                </th>

                {/* ACS */}
                <th className="px-3 py-2.5 text-center">
                  <ColHeader tip={
                    <TipBody
                      title="ACS — Accumulation Confidence Score"
                      color="#2dd4bf"
                      desc="Detects institutional 'smart money' accumulation before a move is publicly recognized. Measures: up-volume ratio, relative strength vs SPY, price compression (coiling), closing strength, and volume surge patterns. ACS rising while price is flat is classic stealth accumulation — the market is loading up quietly before a re-rating."
                      levels={[
                        ["≥ 75", "Strong accumulation. Institutional buyers are building positions aggressively. This level alongside high INS is the EARLY IGNITION flag — highest-quality pre-breakout signal in the system."],
                        ["≥ 55", "Moderate accumulation. Buying pressure is building — watch for follow-through and INS confirmation before sizing up."],
                        ["≥ 35", "Weak or inconsistent. Some buying activity but not sustained. Do not act on ACS alone at this level."],
                        ["< 35",  "No accumulation signal. Smart money is not engaged. Without ACS support, any INS move has lower conviction."],
                        ["↑ trend", "Buying pressure intensifying across snapshots. This is the most actionable ACS signal — it means the accumulation is not random, it is directional."],
                        ["+N 1D Δ",  "ACS improved N points since the last snapshot. Use the 'ACS Δ1D' sort to surface stocks where institutional buying just shifted — these are often 1–4 weeks ahead of a public breakout."],
                      ]}
                    />
                  }>
                    <span className="text-teal-400">ACS</span>
                    <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">trend · 1D</span>
                  </ColHeader>
                </th>

                {/* COS */}
                <th className="px-3 py-2.5 text-center hidden lg:table-cell">
                  <ColHeader tip={
                    <TipBody
                      title="COS — Combined Opportunity Score"
                      color="#34d399"
                      desc="The confirmation signal — blends VQS (fundamental quality) with GVS (price momentum). COS intentionally lags INS by design. The relationship between INS and COS is the key read: use INS to get in early, then watch COS to confirm the move is real. When COS finally catches up to a high INS reading, the breakout is entering mid-stage and the risk profile changes."
                      levels={[
                        ["≥ 75", "High conviction — both quality fundamentals and price momentum are confirmed and elevated together. Breakout is mid-stage or later."],
                        ["≥ 55", "Moderate opportunity. Decent setup but not fully extended. COS at this level while INS is higher is the ideal pre-breakout configuration."],
                        ["≥ 35", "Low opportunity. Wait for COS to improve before committing."],
                        ["< 35",  "Avoid. Weak fundamentals and/or no price momentum — no edge here."],
                        ["COS > INS", "Late-stage warning pattern. COS has run ahead of INS — the crowd may be late to the move and risk/reward is poor."],
                        ["INS > COS", "Pre-consensus setup. The leading signal is elevated but confirmation hasn't arrived yet. This gap is where the best entries live."],
                        ["+N 1D Δ",  "COS accelerating after INS already rose is a breakout confirmation pattern — the move is transitioning from speculative to confirmed."],
                      ]}
                    />
                  }>
                    <span className="text-emerald-500">COS</span>
                    <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">1D</span>
                  </ColHeader>
                </th>

                {/* INS sparkline */}
                <th className="px-3 py-2.5 text-center hidden lg:table-cell">
                  <ColHeader tip={
                    <TipBody
                      title="INS Sparkline — Signal Trajectory"
                      color="#a78bfa"
                      desc="A rolling chart of the INS score across the last 30 snapshots (~15 hours of data, one snapshot every 30 min). The shape of the curve is often more informative than the score itself — a stock at INS 60 with a sharply rising sparkline is more interesting than a stock at INS 68 with a flat or declining one."
                      levels={[
                        ["Rising",    "Momentum is accelerating. Often the earliest visual signal before the score crosses a key threshold. Best when curve is steepening, not just drifting up."],
                        ["Bottoming", "Score declined but the curve is curling up. Watch for INS acceleration on the next few snapshots — this is a potential inflection point."],
                        ["Flat",      "Score is stable with no directional signal. Neutral — wait for a catalyst or ACS movement before acting."],
                        ["Falling",   "Momentum is fading. Avoid new entries. If already in the position, consider whether the thesis is still intact."],
                        ["Spike",     "Sharp single-snapshot move. Could be noise — wait for the next 2–3 snapshots to see if it holds or reverts before acting on it."],
                      ]}
                    />
                  }>
                    <span className="text-violet-400/60">INS</span>
                    <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">spark</span>
                  </ColHeader>
                </th>

                {/* Signal Flag */}
                <th className="px-3 py-2.5 text-left hidden xl:table-cell">
                  <ColHeader align="left" tip={
                    <TipBody
                      title="Divergence Signal Flag"
                      color="#c4b5fd"
                      desc="Fires when two or more scores diverge in a statistically significant pattern. Each flag identifies a different inflection point type before it becomes obvious in price. These are the highest-signal events in the system — a flag with a rising INS sparkline and a rising ACS trend is your strongest actionable setup."
                      levels={[
                        ["EARLY IGNITION", "INS↑ + ACS↑ + COS still below 65. Both the leading signal and institutional money are moving before the crowd. This is the pre-breakout setup with the best risk/reward. Highest-conviction early entry pattern in the system."],
                        ["INSTITUTIONAL", "ACS↑ + INS↑ + COS flat. Smart money is accumulating quietly with no price confirmation yet. Patient entry with a defined stop — this flag often appears 1–4 weeks before a re-rating."],
                        ["SPECULATIVE", "INS↑ + COS flat or falling. Momentum exists but without fundamental backing or confirmation. Can still work short-term but carries higher false breakout risk. Size smaller and keep stops tight."],
                        ["LATE CYCLE",  "COS extended + INS declining. The crowd is piling in after the move is already over. Risk/reward is poor — consider trimming existing positions or waiting for a full reset before re-entering."],
                      ]}
                    />
                  }>
                    Signal Flag
                  </ColHeader>
                </th>
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
