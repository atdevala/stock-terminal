import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Gauge,
  Layers3,
  Radar,
  ShieldAlert,
  TrendingUp,
  Zap,
} from "lucide-react";
import type {
  Quote,
  SignalDelta,
  StockCategory,
  StockScore,
} from "@workspace/api-client-react";
import { stripEmoji } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export type CommandCenterFilter =
  | "all"
  | "accumulation"
  | "rising"
  | "superstock"
  | "divergence"
  | "latecycle";

export type CommandCenterOpportunity = {
  ticker: string;
  company: string;
  sector: string;
  score: StockScore;
  quote?: Quote;
  rankScore: number;
};

export type CommandCenterRisk = {
  ticker: string;
  company: string;
  reason: string;
  riskScore: number;
  score?: StockScore;
  quote?: Quote;
};

export type SectorSignalSummary = {
  name: string;
  color: string;
  count: number;
  scored: number;
  avgCsos: number;
  avgIns: number;
  accumulation: number;
};

export type SignalBreadthSummary = {
  total: number;
  scored: number;
  accumulation: number;
  rising: number;
  divergence: number;
  lateCycle: number;
  avgCsos: number;
};

type SignalCommandCenterProps = {
  categories: StockCategory[];
  quotesMap: Map<string, Quote>;
  scoresMap: Map<string, StockScore>;
  deltasMap: Map<string, SignalDelta>;
  activeFilter: CommandCenterFilter;
  onSelectFilter: (filter: CommandCenterFilter) => void;
};

function scoreValue(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function signedPercent(value: number | undefined): string {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value! >= 0 ? "+" : ""}${value!.toFixed(2)}%`;
}

function isRising(delta: SignalDelta | undefined): boolean {
  const trend = delta?.trends?.ins;
  return trend === "RISING" || trend === "STRONGLY_RISING";
}

function isLateCycle(score: StockScore | undefined, delta: SignalDelta | undefined): boolean {
  if (!score) return false;
  return (
    score.signalLabel === "LATE STAGE MOVE" ||
    score.fbrs > 70 ||
    (score.cos > 78 && scoreValue(score.ins) < 48) ||
    delta?.divergence?.includes("LATE CYCLE") === true
  );
}

function buildUniverse(categories: StockCategory[]) {
  return categories.flatMap(category =>
    category.stocks.map(stock => ({
      stock,
      sector: stripEmoji(category.name),
      color: category.color,
    })),
  );
}

// Ranks by the single retained composite score — no separate CSOS/INS/ACS/CPE/BPS blend.
function scoreOpportunity(score: StockScore): number {
  return scoreValue(score.signalScore);
}

function riskReason(score: StockScore | undefined, delta: SignalDelta | undefined, quote: Quote | undefined): string {
  if (delta?.divergence?.includes("LATE CYCLE")) return "Late-cycle divergence";
  if (score?.signalLabel === "LATE STAGE MOVE") return "Late-stage move";
  if ((score?.fbrs ?? 0) > 70) return "False breakout risk";
  if (score && score.cos > 78 && scoreValue(score.ins) < 48) return "COS extended, INS fading";
  if ((quote?.changePercent ?? 0) <= -5) return "Price pressure";
  return "Risk monitor";
}

function riskRank(score: StockScore | undefined, delta: SignalDelta | undefined, quote: Quote | undefined): number {
  return (
    (score?.fbrs ?? 0) +
    (score?.signalLabel === "LATE STAGE MOVE" ? 25 : 0) +
    (delta?.divergence ? 16 : 0) +
    Math.max(0, -(quote?.changePercent ?? 0)) * 2
  );
}

function CommandMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "green" | "amber" | "red" | "violet";
}) {
  const toneClass = {
    neutral: "text-zinc-100",
    green: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-red-300",
    violet: "text-violet-300",
  }[tone];

  return (
    <div className="min-w-0 border-r border-zinc-800/80 px-3 py-2 last:border-r-0">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold leading-none tabular-nums", toneClass)}>{value}</div>
      <div className="mt-1 truncate text-[11px] text-zinc-500">{detail}</div>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number | undefined }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400">
      {label}
      <span className="font-mono text-zinc-100">{Math.round(scoreValue(value))}</span>
    </span>
  );
}

export function SignalCommandCenter({
  categories,
  quotesMap,
  scoresMap,
  deltasMap,
  activeFilter,
  onSelectFilter,
}: SignalCommandCenterProps) {
  const universe = useMemo(() => buildUniverse(categories), [categories]);

  const breadth = useMemo<SignalBreadthSummary>(() => {
    const scored = universe
      .map(item => scoresMap.get(item.stock.ticker))
      .filter((score): score is StockScore => Boolean(score));

    const totalSignal = scored.reduce((sum, score) => sum + scoreValue(score.signalScore), 0);

    return {
      total: universe.length,
      scored: scored.length,
      accumulation: scored.filter(score => score.acs >= 65).length,
      rising: universe.filter(item => isRising(deltasMap.get(item.stock.ticker))).length,
      divergence: universe.filter(item => {
        const divergence = deltasMap.get(item.stock.ticker)?.divergence;
        return typeof divergence === "string" && divergence.trim() !== "";
      }).length,
      lateCycle: universe.filter(item => isLateCycle(scoresMap.get(item.stock.ticker), deltasMap.get(item.stock.ticker))).length,
      avgCsos: scored.length ? Math.round(totalSignal / scored.length) : 0,
    };
  }, [deltasMap, scoresMap, universe]);

  const opportunities = useMemo<CommandCenterOpportunity[]>(
    () => universe
      .map(item => {
        const score = scoresMap.get(item.stock.ticker);
        if (!score) return null;
        return {
          ticker: item.stock.ticker,
          company: item.stock.company,
          sector: item.sector,
          score,
          quote: quotesMap.get(item.stock.ticker),
          rankScore: scoreOpportunity(score),
        };
      })
      .filter((item): item is CommandCenterOpportunity => Boolean(item))
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, 6),
    [quotesMap, scoresMap, universe],
  );

  const risks = useMemo<CommandCenterRisk[]>(
    () => universe
      .map(item => {
        const score = scoresMap.get(item.stock.ticker);
        const delta = deltasMap.get(item.stock.ticker);
        const quote = quotesMap.get(item.stock.ticker);
        if (!isLateCycle(score, delta) && (quote?.changePercent ?? 0) > -5) return null;
        return {
          ticker: item.stock.ticker,
          company: item.stock.company,
          score,
          quote,
          reason: riskReason(score, delta, quote),
          riskScore: riskRank(score, delta, quote),
        };
      })
      .filter((item): item is CommandCenterRisk => Boolean(item))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 5),
    [deltasMap, quotesMap, scoresMap, universe],
  );

  const sectorSummaries = useMemo<SectorSignalSummary[]>(
    () => categories
      .map(category => {
        const scored = category.stocks
          .map(stock => scoresMap.get(stock.ticker))
          .filter((score): score is StockScore => Boolean(score));

        const avgCsos = scored.length
          ? Math.round(scored.reduce((sum, score) => sum + scoreValue(score.signalScore), 0) / scored.length)
          : 0;

        const avgIns = scored.length
          ? Math.round(scored.reduce((sum, score) => sum + scoreValue(score.ins), 0) / scored.length)
          : 0;

        return {
          name: stripEmoji(category.name),
          color: category.color,
          count: category.stocks.length,
          scored: scored.length,
          avgCsos,
          avgIns,
          accumulation: scored.filter(score => score.acs >= 65).length,
        };
      })
      .sort((a, b) => b.avgCsos - a.avgCsos)
      .slice(0, 6),
    [categories, scoresMap],
  );

  const actionButtonClass = (filter: CommandCenterFilter) => cn(
    "rounded border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
    activeFilter === filter
      ? "border-amber-500/70 bg-amber-500/15 text-amber-200"
      : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100",
  );

  return (
    <section className="space-y-3" aria-label="Signal Command Center">
      <div className="overflow-hidden rounded-md border border-zinc-800 bg-black/35 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-3 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300">
              <Radar className="h-4 w-4" />
              Signal Command Center
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">
              Live opportunity, risk, and sector intelligence
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onSelectFilter("all")} className={actionButtonClass("all")}>All</button>
            <button type="button" onClick={() => onSelectFilter("accumulation")} className={actionButtonClass("accumulation")}>Accumulation</button>
            <button type="button" onClick={() => onSelectFilter("rising")} className={actionButtonClass("rising")}>Rising</button>
            <button type="button" onClick={() => onSelectFilter("latecycle")} className={actionButtonClass("latecycle")}>Risk</button>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b border-zinc-800 bg-zinc-950/35 md:grid-cols-4 xl:grid-cols-6">
          <CommandMetric label="Universe" value={breadth.total} detail={`${breadth.scored} scored`} />
          <CommandMetric label="Avg Signal" value={breadth.avgCsos} detail="Watchlist breadth" tone="amber" />
          <CommandMetric label="Accumulation" value={breadth.accumulation} detail="ACS >= 65" tone="green" />
          <CommandMetric label="Rising INS" value={breadth.rising} detail="Signal trend up" tone="violet" />
          <CommandMetric label="Divergence" value={breadth.divergence} detail="Active flags" tone="amber" />
          <CommandMetric label="Risk Desk" value={breadth.lateCycle} detail="Late-cycle names" tone="red" />
        </div>

        <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.8fr)]">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-300" />
                <span className="text-sm font-semibold text-zinc-100">Opportunity Radar</span>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-zinc-500">Ranked by composite Signal</span>
            </div>
            <div className="divide-y divide-zinc-800/80">
              {opportunities.map((item, index) => (
                <div key={item.ticker} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/60">
                  <div className="font-mono text-xs text-zinc-500">#{index + 1}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-100">{item.ticker}</span>
                      <span className="truncate text-xs text-zinc-500">{item.company}</span>
                      <span className="rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{item.sector}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <ScorePill label="Signal" value={item.score.signalScore} />
                      {item.score.rsi !== undefined && <ScorePill label="RSI" value={item.score.rsi} />}
                      <span className="text-[10px] text-zinc-500 self-center truncate">{item.score.signalLabel}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm text-zinc-100">{Math.round(item.rankScore)}</div>
                    <div className={cn("flex items-center justify-end gap-1 text-xs", (item.quote?.changePercent ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
                      {(item.quote?.changePercent ?? 0) >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {signedPercent(item.quote?.changePercent)}
                    </div>
                  </div>
                </div>
              ))}
              {opportunities.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-zinc-500">Scores are still loading.</div>
              )}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Layers3 className="h-4 w-4 text-sky-300" />
                  <span className="text-sm font-semibold text-zinc-100">Sector Rotation</span>
                </div>
                <BarChart3 className="h-4 w-4 text-zinc-500" />
              </div>
              <div className="space-y-2 p-3">
                {sectorSummaries.map(sector => (
                  <div key={sector.name}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `#${sector.color}` }} />
                        <span className="truncate text-zinc-300">{sector.name}</span>
                      </div>
                      <span className="font-mono text-zinc-500">Signal {sector.avgCsos}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900">
                      <div
                        className="h-full rounded-full bg-amber-400/80"
                        style={{ width: `${Math.min(100, Math.max(3, sector.avgCsos))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-950/40">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-300" />
                  <span className="text-sm font-semibold text-zinc-100">Risk Desk</span>
                </div>
                <button type="button" onClick={() => onSelectFilter("latecycle")} className="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-red-300">
                  Open risk filter
                </button>
              </div>
              <div className="divide-y divide-zinc-800/80">
                {risks.map(item => (
                  <div key={item.ticker} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
                        <span className="font-semibold text-zinc-100">{item.ticker}</span>
                        <span className="truncate text-xs text-zinc-500">{item.company}</span>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{item.reason}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm text-red-200">{Math.round(item.riskScore)}</div>
                      <div className="text-xs text-zinc-500">risk</div>
                    </div>
                  </div>
                ))}
                {risks.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-zinc-500">
                    No active late-cycle or pressure flags.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid border-t border-zinc-800 bg-zinc-950/45 md:grid-cols-3">
          <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 md:border-b-0 md:border-r">
            <Gauge className="h-4 w-4 text-emerald-300" />
            <div>
              <div className="text-xs font-medium text-zinc-200">Same live data contracts</div>
              <div className="text-[11px] text-zinc-500">Quotes, scores, and deltas from existing APIs</div>
            </div>
          </div>
          <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 md:border-b-0 md:border-r">
            <TrendingUp className="h-4 w-4 text-amber-300" />
            <div>
              <div className="text-xs font-medium text-zinc-200">Command layer first</div>
              <div className="text-[11px] text-zinc-500">Table remains available for drilldown</div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Activity className="h-4 w-4 text-violet-300" />
            <div>
              <div className="text-xs font-medium text-zinc-200">No fake AI or options data</div>
              <div className="text-[11px] text-zinc-500">Future panels stay provider-gated</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
