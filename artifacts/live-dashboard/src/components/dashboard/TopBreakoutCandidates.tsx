import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";

interface BreakoutCandidate {
  ticker: string;
  company: string;
  price: number;
  changePercent: number;
  breakoutReadiness: number;
  reasonLabel: string;
  drivers: { ins: number; acs: number; vqs: number; lqs?: number; rsi?: number; fbrs: number };
  writeup: { status: "ready" | "generating" | "unavailable" | "error"; text: string | null };
}

function reasonTone(label: string): string {
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

// Matches StockRow.tsx's signalColor bands — this IS score.signalScore (see
// breakout.ts's consolidation-pass comment), not a distinct scoring system,
// so it should look like the same number everywhere else, not its own thing.
function signalColor(v: number): string {
  if (v >= 75) return "text-amber-300 border-amber-500/50 bg-amber-500/10";
  if (v >= 55) return "text-amber-400 border-amber-600/40 bg-amber-600/10";
  if (v >= 35) return "text-orange-400 border-orange-500/40 bg-orange-500/10";
  return "text-zinc-500 border-zinc-700/40 bg-zinc-800/30";
}

function DriverChip({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-500">
      {label} <span className="font-mono text-zinc-200">{Math.round(value)}</span>
    </span>
  );
}

function WriteupBlock({ writeup }: { writeup: BreakoutCandidate["writeup"] }) {
  if (writeup.status === "unavailable") {
    return <p className="text-[11px] text-zinc-600 italic">{writeup.text}</p>;
  }
  if (writeup.status === "generating" && !writeup.text) {
    return <p className="text-[11px] text-zinc-500 italic">Generating AI analysis…</p>;
  }
  if (writeup.status === "error" && !writeup.text) {
    return <p className="text-[11px] text-red-400/80 italic">AI analysis failed — will retry shortly.</p>;
  }
  return (
    <p className="text-[11px] text-zinc-400 leading-relaxed">
      {writeup.text}
      {writeup.status === "generating" && <span className="text-zinc-600 italic"> (refreshing…)</span>}
    </p>
  );
}

function CandidateCard({ c }: { c: BreakoutCandidate }) {
  const isUp = c.changePercent >= 0;
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/20 p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-zinc-100">{c.ticker}</span>
            <span className="text-xs text-zinc-500 truncate">{c.company}</span>
          </div>
          <div className={cn("mt-1 text-[12px] font-bold uppercase tracking-wide leading-tight", reasonTone(c.reasonLabel))}>
            {c.reasonLabel}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm text-zinc-200">${c.price.toFixed(2)}</div>
          <div className={cn("text-[11px] font-mono", isUp ? "text-emerald-400" : "text-red-400")}>
            {formatPercent(c.changePercent)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border", signalColor(c.breakoutReadiness))}>
          {c.breakoutReadiness}
        </span>
        <DriverChip label="INS" value={c.drivers.ins} />
        <DriverChip label="ACS" value={c.drivers.acs} />
        <DriverChip label="VQS" value={c.drivers.vqs} />
        {c.drivers.rsi !== undefined && <DriverChip label="RSI" value={c.drivers.rsi} />}
      </div>

      <WriteupBlock writeup={c.writeup} />
    </div>
  );
}

export function TopBreakoutCandidates() {
  const { data, isLoading, isError } = useQuery<BreakoutCandidate[]>({
    queryKey: ["breakout-candidates"],
    queryFn: () => fetch("/api/breakout-candidates").then(r => {
      if (!r.ok) throw new Error("Failed to load breakout candidates");
      return r.json();
    }),
    refetchInterval: 60_000,
  });

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
        <h2 className="text-sm font-bold text-zinc-100">Top Breakout Candidates</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          The 10 stocks across the whole universe with the strongest rising momentum, real accumulation behind it, a fundamental quality floor, and room left to run before overbought.
        </p>
      </div>
      <div className="p-3 space-y-2.5">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
        {isError && <p className="text-sm text-red-400 px-1 py-4">Couldn't load breakout candidates.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-zinc-500 px-1 py-4">
            No stock currently clears the eligibility bar (real INS + RSI data, not currently extended, VQS ≥ 40). Check back as scores populate.
          </p>
        )}
        {data?.map(c => <CandidateCard key={c.ticker} c={c} />)}
      </div>
    </section>
  );
}
