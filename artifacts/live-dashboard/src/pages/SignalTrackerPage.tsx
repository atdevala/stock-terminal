import { useState, useMemo } from "react";
import {
  useGetSignalDeltas,
  useGetScores,
  getGetSignalDeltasQueryKey,
  getGetScoresQueryKey,
  type SignalDelta,
  type SignalValues,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, ResponsiveContainer, Tooltip as ReTooltip } from "recharts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "ins" | "acs" | "cos" | "accelIns" | "accelAcs";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "ins",      label: "INS Score"     },
  { key: "acs",      label: "ACS Score"     },
  { key: "cos",      label: "COS Score"     },
  { key: "accelIns", label: "INS Accel"     },
  { key: "accelAcs", label: "ACS Accel"     },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const DIVERGENCE_COLOR: Record<string, string> = {
  "EARLY IGNITION SETUP":                         "bg-violet-900/60 text-violet-200 border border-violet-700",
  "SPECULATIVE MOMENTUM (UNCONFIRMED)":            "bg-yellow-900/50 text-yellow-200 border border-yellow-700",
  "LATE CYCLE / EXHAUSTION RISK":                  "bg-red-900/50 text-red-200 border border-red-800",
  "INSTITUTIONAL ACCUMULATION BEFORE REPRICING":   "bg-teal-900/50 text-teal-200 border border-teal-700",
};

function DeltaChip({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-zinc-600 text-xs">—</span>;
  if (v === 0)   return <span className="text-zinc-500 text-xs">±0</span>;
  const pos = v > 0;
  return (
    <span className={cn("text-xs font-medium tabular-nums", pos ? "text-emerald-400" : "text-red-400")}>
      {pos ? "+" : ""}{v}
    </span>
  );
}

function TrendArrow({ trend }: { trend: string | undefined }) {
  if (!trend) return null;
  return (
    <span className={cn("text-sm font-bold", TREND_COLOR[trend] ?? "text-zinc-500")}>
      {TREND_ARROW[trend] ?? "→"}
    </span>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

interface SparkPoint { ts: number; ins: number; cos: number; acs: number }

function Sparkline({ data, dataKey, color }: {
  data: SparkPoint[];
  dataKey: "ins" | "cos" | "acs";
  color: string;
}) {
  if (data.length < 2) {
    return (
      <div className="w-16 h-8 flex items-center justify-center">
        <span className="text-[10px] text-zinc-600">no data</span>
      </div>
    );
  }
  return (
    <div className="w-16 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
          <ReTooltip
            contentStyle={{ display: "none" }}
            wrapperStyle={{ display: "none" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Score cell with value + trend arrow + 7D delta ────────────────────────────

function ScoreCell({
  value,
  trend,
  delta7D,
  colorFn,
}: {
  value: number;
  trend: string | undefined;
  delta7D: number | null | undefined;
  colorFn: (v: number) => string;
}) {
  return (
    <td className="px-2 py-2 text-center">
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1">
          <span className={cn("font-bold tabular-nums text-sm", colorFn(value))}>{value}</span>
          <TrendArrow trend={trend} />
        </div>
        <DeltaChip v={delta7D} />
      </div>
    </td>
  );
}

function scoreColor(v: number): string {
  if (v >= 75) return "text-emerald-400";
  if (v >= 55) return "text-yellow-400";
  if (v >= 35) return "text-orange-400";
  return "text-red-400";
}
function insColor(v: number): string {
  if (v >= 75) return "text-violet-300";
  if (v >= 55) return "text-violet-400/80";
  if (v >= 35) return "text-violet-500/70";
  return "text-zinc-500";
}
function acsColor(v: number): string {
  if (v >= 75) return "text-teal-300";
  if (v >= 55) return "text-teal-400/80";
  if (v >= 35) return "text-teal-500/70";
  return "text-zinc-500";
}

// ── Building blocks map for lookup by ticker ──────────────────────────────────

// ── Main page ─────────────────────────────────────────────────────────────────

export function SignalTrackerPage() {
  const [sortBy, setSortBy] = useState<SortKey>("ins");

  const { data: deltas, isLoading } = useGetSignalDeltas({
    query: { queryKey: getGetSignalDeltasQueryKey(), refetchInterval: 60_000 },
  });

  const { data: scores } = useGetScores({
    query: { queryKey: getGetScoresQueryKey(), refetchInterval: 30_000 },
  });

  // Build company name lookup from scores (which has ticker)
  const companyMap = useMemo(() => {
    const m = new Map<string, string>();
    scores?.forEach(s => m.set(s.ticker, s.ticker));
    return m;
  }, [scores]);

  const sorted = useMemo(() => {
    if (!deltas) return [];
    return [...deltas].sort((a, b) => {
      switch (sortBy) {
        case "acs":      return b.current.acs - a.current.acs;
        case "cos":      return b.current.cos - a.current.cos;
        case "accelIns": return (b.accel?.ins ?? 0) - (a.accel?.ins ?? 0);
        case "accelAcs": return (b.accel?.acs ?? 0) - (a.accel?.acs ?? 0);
        default:         return b.current.ins - a.current.ins;
      }
    });
  }, [deltas, sortBy]);

  // ── No data state ─────────────────────────────────────────────────────────

  const hasData = (deltas?.length ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6 space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded" />
        ))}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
        <div className="text-4xl">📈</div>
        <div className="text-lg font-semibold text-zinc-300">Signal history is building</div>
        <div className="text-sm text-zinc-500 max-w-md">
          The tracker snapshots all signal scores every 30 minutes. Deltas, trend arrows, sparklines,
          and divergence flags will appear after the first snapshot is captured.
          <br /><br />
          Snapshots are taken automatically when scores are fetched. Check back shortly.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* ── Header controls ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-2 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Sort by</span>
        <div className="flex gap-1.5 flex-wrap">
          {SORT_OPTIONS.map(o => (
            <button
              key={o.key}
              onClick={() => setSortBy(o.key)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                sortBy === o.key
                  ? "bg-violet-700 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-600">{sorted.length} stocks tracked</span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <table className="w-full text-sm border-collapse min-w-[900px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
            <th className="px-3 py-2 text-left w-[90px]">Ticker</th>

            <th className="px-2 py-2 text-center" colSpan={2}>
              <span className="text-violet-400">INS</span>
              <span className="ml-1 text-zinc-600">7D</span>
            </th>
            <th className="px-2 py-2 text-center text-[10px] text-zinc-600">Spark</th>

            <th className="px-2 py-2 text-center" colSpan={2}>
              <span className="text-teal-400">ACS</span>
              <span className="ml-1 text-zinc-600">7D</span>
            </th>
            <th className="px-2 py-2 text-center text-[10px] text-zinc-600">Spark</th>

            <th className="px-2 py-2 text-center" colSpan={2}>
              <span className="text-emerald-400">COS</span>
              <span className="ml-1 text-zinc-600">7D</span>
            </th>
            <th className="px-2 py-2 text-center text-[10px] text-zinc-600">Spark</th>

            <th className="px-2 py-2 text-center">
              <span className="text-yellow-500">VQS</span>
            </th>
            <th className="px-2 py-2 text-center">
              <span className="text-orange-400">GVS</span>
            </th>

            <th className="px-3 py-2 text-left">Flag</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const history = row.history ?? [];
            const divStyle = row.divergence ? DIVERGENCE_COLOR[row.divergence] : null;

            return (
              <tr
                key={row.ticker}
                className={cn(
                  "border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors",
                  idx % 2 === 0 ? "bg-transparent" : "bg-zinc-900/20"
                )}
              >
                {/* Ticker */}
                <td className="px-3 py-2">
                  <span className="font-mono font-bold text-zinc-100 text-sm">{row.ticker}</span>
                </td>

                {/* INS */}
                <ScoreCell
                  value={row.current.ins}
                  trend={row.trends?.ins}
                  delta7D={row.delta7D?.ins}
                  colorFn={insColor}
                />
                <td className="px-1 py-1 text-center">
                  <div className="flex items-center gap-0.5">
                    {row.accel?.ins != null && (
                      <Tooltip>
                        <TooltipTrigger>
                          <span className={cn(
                            "text-[10px] font-medium",
                            row.accel.ins > 0 ? "text-violet-400" : row.accel.ins < 0 ? "text-red-400" : "text-zinc-600"
                          )}>
                            {row.accel.ins > 0 ? "⚡" : row.accel.ins < 0 ? "▼" : ""}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent style={{ backgroundColor: "#000000" }}>
                          INS acceleration: {row.accel.ins > 0 ? "+" : ""}{row.accel.ins}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="px-1 py-1">
                  <Sparkline data={history} dataKey="ins" color="#a78bfa" />
                </td>

                {/* ACS */}
                <ScoreCell
                  value={row.current.acs}
                  trend={row.trends?.acs}
                  delta7D={row.delta7D?.acs}
                  colorFn={acsColor}
                />
                <td className="px-1 py-1 text-center">
                  {row.accel?.acs != null && (
                    <Tooltip>
                      <TooltipTrigger>
                        <span className={cn(
                          "text-[10px] font-medium",
                          row.accel.acs > 0 ? "text-teal-400" : row.accel.acs < 0 ? "text-red-400" : "text-zinc-600"
                        )}>
                          {row.accel.acs > 0 ? "⚡" : row.accel.acs < 0 ? "▼" : ""}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent style={{ backgroundColor: "#000000" }}>
                        ACS acceleration: {row.accel.acs > 0 ? "+" : ""}{row.accel.acs}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </td>
                <td className="px-1 py-1">
                  <Sparkline data={history} dataKey="acs" color="#2dd4bf" />
                </td>

                {/* COS */}
                <ScoreCell
                  value={row.current.cos}
                  trend={row.trends?.cos}
                  delta7D={row.delta7D?.cos}
                  colorFn={scoreColor}
                />
                <td className="px-1 py-1 text-center" />
                <td className="px-1 py-1">
                  <Sparkline data={history} dataKey="cos" color="#34d399" />
                </td>

                {/* VQS */}
                <td className="px-2 py-2 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className={cn("font-bold tabular-nums text-sm", scoreColor(row.current.vqs))}>
                        {row.current.vqs}
                      </span>
                      <TrendArrow trend={row.trends?.vqs} />
                    </div>
                    <DeltaChip v={row.delta7D?.vqs} />
                  </div>
                </td>

                {/* GVS */}
                <td className="px-2 py-2 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className={cn("font-bold tabular-nums text-sm", scoreColor(row.current.gvs))}>
                        {row.current.gvs}
                      </span>
                      <TrendArrow trend={row.trends?.gvs} />
                    </div>
                    <DeltaChip v={row.delta7D?.gvs} />
                  </div>
                </td>

                {/* Divergence flag */}
                <td className="px-3 py-2 min-w-[180px]">
                  {divStyle && (
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded text-[10px] font-medium leading-tight",
                      divStyle
                    )}>
                      {row.divergence}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <div className="px-4 py-4 border-t border-zinc-800 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-zinc-500">
        <span><span className="text-emerald-400 font-bold">↑↑</span> Strongly Rising (+6+)</span>
        <span><span className="text-emerald-500/80 font-bold">↑</span> Rising (+2 to +5)</span>
        <span><span className="text-zinc-500 font-bold">→</span> Flat (−1 to +1)</span>
        <span><span className="text-red-500/80 font-bold">↓</span> Falling (−2 to −5)</span>
        <span><span className="text-red-400 font-bold">↓↓</span> Strongly Falling (−6−)</span>
        <span className="text-zinc-600">|</span>
        <span><span className="text-violet-200 font-medium">EARLY IGNITION</span> INS↑ + ACS↑ + COS&lt;65</span>
        <span><span className="text-teal-200 font-medium">INSTITUTIONAL ACCUM.</span> ACS↑ + INS↑ + COS flat</span>
        <span className="text-zinc-600">Numbers below score = 7D delta</span>
        <span>⚡ = positive acceleration (momentum building)</span>
      </div>
    </div>
  );
}
