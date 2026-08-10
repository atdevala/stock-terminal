import { useEffect, useMemo, useState } from "react";
import type { Quote, StockInfo, StockScore } from "@workspace/api-client-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, Loader2, TrendingUp } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface MacdPoint {
  date: string;
  close: number;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  marker?: "buy" | "sell";
}

interface MacdResponse {
  ticker: string;
  range: "6M";
  points: MacdPoint[];
  cached: boolean;
  updatedAt: number;
}

interface WatchlistMacdInspectorProps {
  stock?: StockInfo;
  quote?: Quote;
  score?: StockScore;
}

interface TooltipPayload {
  payload?: MacdPoint;
}

function MacdTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-md border border-zinc-700 bg-black px-3 py-2 text-xs shadow-2xl">
      <div className="mb-1 font-mono text-[11px] text-zinc-300">{point.date}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-zinc-500">Close</span>
        <span className="text-right font-mono text-zinc-100">{formatCurrency(point.close)}</span>
        <span className="text-zinc-500">MACD</span>
        <span className="text-right font-mono text-blue-300">{point.macd?.toFixed(3) ?? "-"}</span>
        <span className="text-zinc-500">Signal</span>
        <span className="text-right font-mono text-red-300">{point.signal?.toFixed(3) ?? "-"}</span>
        <span className="text-zinc-500">Hist</span>
        <span className={cn("text-right font-mono", (point.histogram ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
          {point.histogram?.toFixed(3) ?? "-"}
        </span>
      </div>
    </div>
  );
}

function scoreTone(score?: number): string {
  if (score === undefined) return "text-zinc-500";
  if (score >= 75) return "text-emerald-300";
  if (score >= 55) return "text-amber-300";
  if (score >= 35) return "text-orange-300";
  return "text-red-300";
}

function signalLabelTone(label: string): string {
  if (label === "PRIME OPPORTUNITY")                return "text-emerald-300";
  if (label === "EARLY BREAKOUT SETUP")             return "text-amber-300";
  if (label === "STEALTH ACCUMULATION")             return "text-teal-300";
  if (label === "HIDDEN CATALYST POTENTIAL")        return "text-sky-300";
  if (label.startsWith("QUALITY COMPOUNDER"))       return "text-blue-300";
  if (label === "CONFIRMED TREND")                  return "text-amber-400";
  if (label === "DEVELOPING SETUP")                 return "text-zinc-400";
  if (label === "LATE STAGE MOVE")                  return "text-orange-400";
  return "text-red-400";
}

export function WatchlistMacdInspector({ stock, quote, score }: WatchlistMacdInspectorProps) {
  const [data, setData] = useState<MacdResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!stock?.ticker) {
      setData(null);
      setStatus("idle");
      setMessage("");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setMessage("");

    fetch(`/api/stocks/${encodeURIComponent(stock.ticker)}/macd`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as MacdResponse | { error?: string; reason?: string } | null;
        if (!response.ok) {
          const errorBody = body as { error?: string; reason?: string } | null;
          throw new Error(errorBody?.error ?? "MACD chart unavailable.");
        }
        return body as MacdResponse;
      })
      .then(payload => {
        setData(payload);
        setStatus("success");
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setData(null);
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "MACD chart unavailable.");
      });

    return () => controller.abort();
  }, [stock?.ticker]);

  const chartPoints = data?.points ?? [];
  const buyMarkers = useMemo(() => chartPoints.filter(point => point.marker === "buy"), [chartPoints]);
  const sellMarkers = useMemo(() => chartPoints.filter(point => point.marker === "sell"), [chartPoints]);
  const priceChangeIsUp = (quote?.change ?? 0) >= 0;

  if (!stock) {
    return (
      <aside className="rounded-md border border-zinc-800 bg-black/30 p-4 text-sm text-zinc-500">
        Select a stock to load its MACD chart.
      </aside>
    );
  }

  return (
    <aside className="rounded-md border border-zinc-800 bg-[#080b10] shadow-2xl shadow-black/20">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-300" />
              <h3 className="font-mono text-lg font-bold text-zinc-100">{stock.ticker}</h3>
              <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-zinc-400">
                MACD
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-zinc-500" title={stock.company}>{stock.company}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-base font-semibold text-zinc-100">
              {quote ? formatCurrency(quote.price) : "-"}
            </div>
            <div className={cn("font-mono text-xs", priceChangeIsUp ? "text-emerald-300" : "text-red-300")}>
              {quote ? formatPercent(quote.changePercent) : "-"}
            </div>
          </div>
        </div>

        {score?.signalLabel && (
          <div className={cn("mt-3 text-[10px] font-bold uppercase tracking-wide", signalLabelTone(score.signalLabel))}>
            {score.signalLabel}
          </div>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([
            ["INS", score?.ins],
            ["ACS", score?.acs],
            ["RSI", score?.rsi !== undefined ? Math.round(score.rsi) : undefined],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded border border-zinc-800 bg-black/30 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-widest text-zinc-600">{label}</div>
              <div className={cn("font-mono text-sm font-bold", scoreTone(typeof value === "number" ? value : undefined))}>
                {typeof value === "number" ? value : "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3">
        {status === "loading" && (
          <div className="flex h-[260px] items-center justify-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading MACD candles...
          </div>
        )}

        {status === "error" && (
          <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center text-sm text-zinc-400">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            <span>{message}</span>
          </div>
        )}

        {status === "success" && chartPoints.length > 0 && (
          <div className="space-y-2">
            <div className="h-[112px] rounded border border-zinc-900/80 bg-black/20 px-1 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPoints} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    hide
                  />
                  <YAxis
                    yAxisId="price"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    tickFormatter={value => `$${Number(value).toFixed(0)}`}
                    width={42}
                    axisLine={false}
                    tickLine={false}
                    domain={["dataMin", "dataMax"]}
                  />
                  <ReTooltip content={<MacdTooltip />} cursor={{ stroke: "#3f3f46", strokeDasharray: "3 3" }} />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="close"
                    dot={false}
                    stroke="#f8fafc"
                    strokeWidth={2}
                    connectNulls
                  />
                  <Scatter yAxisId="price" data={buyMarkers} dataKey="close" fill="#22c55e" shape="triangle" />
                  <Scatter yAxisId="price" data={sellMarkers} dataKey="close" fill="#f87171" shape="triangle" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="h-[170px] rounded border border-zinc-900/80 bg-black/20 px-1 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartPoints} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    tickFormatter={value => String(value).slice(5)}
                    minTickGap={26}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="macd"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    width={42}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <ReferenceLine yAxisId="macd" y={0} stroke="#52525b" strokeDasharray="3 3" />
                  <ReTooltip content={<MacdTooltip />} cursor={{ stroke: "#3f3f46", strokeDasharray: "3 3" }} />
                  <Bar yAxisId="macd" dataKey="histogram" barSize={3} radius={[1, 1, 0, 0]}>
                    {chartPoints.map(point => (
                      <Cell
                        key={point.date}
                        fill={(point.histogram ?? 0) >= 0 ? "rgba(16,185,129,0.34)" : "rgba(248,113,113,0.34)"}
                      />
                    ))}
                  </Bar>
                  <Line yAxisId="macd" type="monotone" dataKey="macd" dot={false} stroke="#6478ff" strokeWidth={2} connectNulls />
                  <Line yAxisId="macd" type="monotone" dataKey="signal" dot={false} stroke="#ff6b6b" strokeWidth={2} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {status === "success" && chartPoints.length === 0 && (
          <div className="flex h-[260px] items-center justify-center text-sm text-zinc-500">
            No MACD points available.
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-3 text-[10px] uppercase tracking-widest text-zinc-600">
          <span className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-zinc-500" />
            6M Price + MACD
          </span>
          <span>{data?.cached ? "Cached" : "Live fetch"}</span>
        </div>
      </div>
    </aside>
  );
}
