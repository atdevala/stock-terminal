import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";

interface OptionsCandidate {
  ticker: string;
  company: string;
  price: number;
  changePercent: number;
  direction: "Call Candidate" | "Put Candidate";
  optionsSetupScore: number;
  realizedVolatility20d: number;
  nextEarnings: { date: string; daysAway: number } | null;
  closes60d: number[];
  drivers: { rsi: number; acs: number };
  writeup: { status: "ready" | "generating" | "unavailable" | "error"; text: string | null };
}

function directionTone(direction: string): string {
  return direction === "Call Candidate"
    ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
    : "text-red-300 border-red-500/40 bg-red-500/10";
}

function MiniChart({ closes, direction }: { closes: number[]; direction: string }) {
  if (closes.length < 2) return <div className="h-14 flex items-center justify-center text-[10px] text-zinc-700">No chart data</div>;
  const data = closes.map((c, i) => ({ i, c }));
  const color = direction === "Call Candidate" ? "#34d399" : "#f87171";
  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Line type="monotone" dataKey="c" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function WriteupBlock({ writeup }: { writeup: OptionsCandidate["writeup"] }) {
  if (writeup.status === "unavailable") return <p className="text-[11px] text-zinc-600 italic">{writeup.text}</p>;
  if (writeup.status === "generating" && !writeup.text) return <p className="text-[11px] text-zinc-500 italic">Generating AI analysis…</p>;
  if (writeup.status === "error" && !writeup.text) return <p className="text-[11px] text-red-400/80 italic">AI analysis failed — will retry shortly.</p>;
  return (
    <p className="text-[11px] text-zinc-400 leading-relaxed">
      {writeup.text}
      {writeup.status === "generating" && <span className="text-zinc-600 italic"> (refreshing…)</span>}
    </p>
  );
}

function CandidateCard({ c }: { c: OptionsCandidate }) {
  const isUp = c.changePercent >= 0;
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/20 p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-zinc-100">{c.ticker}</span>
            <span className="text-xs text-zinc-500 truncate">{c.company}</span>
          </div>
          <div className={cn("mt-1 inline-block text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border", directionTone(c.direction))}>
            {c.direction}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm text-zinc-200">${c.price.toFixed(2)}</div>
          <div className={cn("text-[11px] font-mono", isUp ? "text-emerald-400" : "text-red-400")}>
            {formatPercent(c.changePercent)}
          </div>
        </div>
      </div>

      <MiniChart closes={c.closes60d} direction={c.direction} />

      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-zinc-500">
        <span className="rounded border border-zinc-800 bg-black/30 px-1.5 py-0.5">
          20D realized vol <span className="font-mono text-zinc-200">{c.realizedVolatility20d}%</span>
        </span>
        <span className="rounded border border-zinc-800 bg-black/30 px-1.5 py-0.5">
          RSI <span className="font-mono text-zinc-200">{Math.round(c.drivers.rsi)}</span>
        </span>
        <span className="rounded border border-zinc-800 bg-black/30 px-1.5 py-0.5">
          ACS <span className="font-mono text-zinc-200">{Math.round(c.drivers.acs)}</span>
        </span>
        {c.nextEarnings ? (
          <span className="rounded border border-amber-800/50 bg-amber-900/20 px-1.5 py-0.5 text-amber-300">
            Earnings {c.nextEarnings.date} ({c.nextEarnings.daysAway}d)
          </span>
        ) : (
          <span className="rounded border border-zinc-800 bg-black/30 px-1.5 py-0.5">No earnings in next 10d</span>
        )}
      </div>

      <WriteupBlock writeup={c.writeup} />
    </div>
  );
}

export function OptionsSetupsToWatch() {
  const { data, isLoading, isError } = useQuery<OptionsCandidate[]>({
    queryKey: ["options-watch"],
    queryFn: () => fetch("/api/options-watch").then(r => {
      if (!r.ok) throw new Error("Failed to load options candidates");
      return r.json();
    }),
    refetchInterval: 60_000,
  });

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
        <h2 className="text-sm font-bold text-zinc-100">Options Setups to Watch</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          5 names with a real reason to be in play right now — elevated realized volatility and/or a scheduled earnings date — plus a clear directional read from RSI and accumulation.
        </p>
      </div>
      <div className="p-3 space-y-2.5">
        {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
        {isError && <p className="text-sm text-red-400 px-1 py-4">Couldn't load options candidates.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-zinc-500 px-1 py-4">
            No stock currently clears the bar (needs a real earnings date in the next 10 days, or 20-day realized volatility over 35%, plus a clear overbought/oversold read). Check back as data populates.
          </p>
        )}
        {data?.map(c => <CandidateCard key={c.ticker} c={c} />)}
      </div>
    </section>
  );
}
