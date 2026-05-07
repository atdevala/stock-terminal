import { useState } from "react";
import { RefreshCw, Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  useGetScanner,
  useRefreshScanner,
  getGetScannerQueryKey,
  type ScanResult,
  type ScannerResponse,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanFilter = "all" | "precos" | "highconv" | "falsemom";

// ── Filter definitions ────────────────────────────────────────────────────────

const FILTERS: { key: ScanFilter; label: string; desc: string; base: string; active: string }[] = [
  {
    key:    "all",
    label:  "All Stocks",
    desc:   "Show all scanner results",
    base:   "border-zinc-600 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
    active: "border-zinc-400 bg-zinc-700/50 text-white",
  },
  {
    key:    "precos",
    label:  "⚡ Pre-COS Breakout",
    desc:   "INS > 70 & COS < 65 — pre-consensus early candidates",
    base:   "border-yellow-700 text-yellow-500 hover:border-yellow-500 hover:text-yellow-300",
    active: "border-yellow-500 bg-yellow-900/40 text-yellow-200",
  },
  {
    key:    "highconv",
    label:  "🔥 High Conviction",
    desc:   "INS > 75 & COS > 70 — CRDO-type compounder setup",
    base:   "border-emerald-700 text-emerald-500 hover:border-emerald-500 hover:text-emerald-300",
    active: "border-emerald-500 bg-emerald-900/40 text-emerald-200",
  },
  {
    key:    "falsemom",
    label:  "⚠️ Late Cycle Risk",
    desc:   "COS > 70 & INS < 50 — consensus high but momentum fading",
    base:   "border-red-800 text-red-500 hover:border-red-600 hover:text-red-300",
    active: "border-red-600 bg-red-900/40 text-red-200",
  },
];

// ── Color helpers ─────────────────────────────────────────────────────────────

function insColors(s: number): string {
  if (s >= 75) return "text-violet-200 border-violet-500/60 bg-violet-500/20";
  if (s >= 65) return "text-violet-300 border-violet-600/40 bg-violet-600/15";
  if (s >= 50) return "text-violet-400/80 border-violet-700/30 bg-violet-700/10";
  return "text-zinc-500 border-zinc-700/40 bg-zinc-800/20";
}

function scoreColor(s: number): string {
  if (s >= 75) return "text-emerald-400";
  if (s >= 55) return "text-yellow-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

function brkBarColor(s: number): string {
  if (s >= 70) return "bg-emerald-400";
  if (s >= 50) return "bg-yellow-400";
  return "bg-zinc-600";
}

function alertChipStyle(tag: string): string {
  if (tag === "EARLY IGNITION ZONE") return "bg-violet-500/15 text-violet-300 border-violet-500/30";
  if (tag === "EXHAUSTION WARNING")  return "bg-red-500/15 text-red-300 border-red-500/30";
  if (tag === "EARLY OPPORTUNITY")   return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
  if (tag === "CRDO-TYPE SETUP")     return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (tag === "LATE CYCLE RISK")     return "bg-red-500/15 text-red-300 border-red-500/30";
  return "";
}

// ── Momentum display ──────────────────────────────────────────────────────────

function momentumInfo(v: number): { icon: React.ReactNode; label: string; color: string } {
  if (v >= 68) return { icon: <TrendingUp  className="w-3.5 h-3.5" />, label: "Rising Fast", color: "text-emerald-400" };
  if (v >= 56) return { icon: <TrendingUp  className="w-3.5 h-3.5" />, label: "Rising",       color: "text-green-400"   };
  if (v >= 44) return { icon: <Minus       className="w-3.5 h-3.5" />, label: "Flat",          color: "text-zinc-400"    };
  if (v >= 32) return { icon: <TrendingDown className="w-3.5 h-3.5" />, label: "Slowing",     color: "text-yellow-400"  };
  return         { icon: <TrendingDown className="w-3.5 h-3.5" />, label: "Falling",      color: "text-red-400"     };
}

// ── INS classification label (abbreviated for table) ─────────────────────────

function insShortLabel(s: number): string {
  if (s >= 80) return "EXPLOSIVE";
  if (s >= 65) return "EARLY BUILD";
  if (s >= 50) return "DEVELOPING";
  return "NO EDGE";
}

// ── Filter function ───────────────────────────────────────────────────────────

function applyFilter(results: ScanResult[], filter: ScanFilter): ScanResult[] {
  switch (filter) {
    case "precos":   return results.filter(r => r.ins > 70 && r.cos < 65);
    case "highconv": return results.filter(r => r.ins > 75 && r.cos > 70);
    case "falsemom": return results.filter(r => r.cos > 70 && r.ins < 50);
    default:         return results;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScannerTableRow({ r, showAll }: { r: ScanResult; showAll: boolean }) {
  const mom      = momentumInfo(r.insMomentum);
  const alertStr = r.alert || r.divergenceTag;
  const hasAlert = !!alertStr;

  return (
    <tr className="border-b border-border/40 hover:bg-muted/30 transition-colors duration-100">
      {/* Rank */}
      <td className="py-3 px-3 text-center w-10">
        <span className={cn(
          "text-sm font-bold tabular-nums",
          r.rank === 1 ? "text-yellow-400" :
          r.rank <= 3  ? "text-zinc-300"   : "text-zinc-600"
        )}>{r.rank}</span>
      </td>

      {/* Ticker / Company */}
      <td className="py-3 px-4 min-w-[160px]">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm tracking-wide">{r.ticker}</span>
            <span className={cn(
              "text-[9px] px-1 py-px rounded border font-normal leading-none",
              r.source === "watchlist"
                ? "text-blue-400 border-blue-700/50 bg-blue-900/20"
                : "text-zinc-500 border-zinc-700/40 bg-zinc-800/30"
            )}>
              {r.source === "watchlist" ? "WL" : "SCN"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate max-w-[180px]">{r.company}</div>
        </div>
      </td>

      {/* INS Score */}
      <td className="py-3 px-3 text-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "inline-flex flex-col items-center rounded border px-2 py-1 min-w-[3rem] cursor-help",
              insColors(r.ins)
            )}>
              <span className="font-bold text-base leading-none tabular-nums">{r.ins}</span>
              <span className="text-[9px] mt-0.5 opacity-70 uppercase tracking-tight">
                {insShortLabel(r.ins)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent
            style={{ backgroundColor: "#000000", border: "1px solid #333" }}
            className="text-xs p-3 max-w-xs space-y-1.5"
          >
            <p className="text-violet-300 font-semibold">INS: {r.insLabel}</p>
            {r.insComponents && (
              <div className="space-y-1 text-zinc-400 font-mono">
                <div className="flex justify-between gap-4">
                  <span>Δ GVS Momentum</span>
                  <span className={scoreColor(r.insComponents.deltaGvs)}>{r.insComponents.deltaGvs}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Δ VQS Quality</span>
                  <span className={scoreColor(r.insComponents.deltaVqs)}>{r.insComponents.deltaVqs}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Volume Accel</span>
                  <span className={scoreColor(r.insComponents.volumeAccel)}>{r.insComponents.volumeAccel}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>EPS Slope</span>
                  <span className={scoreColor(r.insComponents.epsSlope)}>{r.insComponents.epsSlope}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Narrative Mom.</span>
                  <span className={scoreColor(r.insComponents.narrativeMomentum)}>{r.insComponents.narrativeMomentum}</span>
                </div>
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </td>

      {/* Breakout Score */}
      <td className="py-3 px-3 text-center hidden sm:table-cell">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-col items-center gap-1 cursor-help">
              <span className={cn("font-bold text-sm tabular-nums", scoreColor(r.breakoutScore))}>
                {r.breakoutScore}
              </span>
              <div className="w-10 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", brkBarColor(r.breakoutScore))}
                  style={{ width: `${r.breakoutScore}%` }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent
            style={{ backgroundColor: "#000000", border: "1px solid #333" }}
            className="text-xs p-2 max-w-xs"
          >
            <p className="font-semibold text-white">Breakout Score: {r.breakoutScore}</p>
            <p className="text-zinc-400 mt-1">50% INS + 30% 7-Day Momentum + 20% Volume Accel</p>
          </TooltipContent>
        </Tooltip>
      </td>

      {/* Momentum */}
      <td className="py-3 px-3 hidden md:table-cell">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("flex items-center gap-1 text-xs font-medium justify-center cursor-help", mom.color)}>
              {mom.icon}
              <span className="hidden lg:inline">{mom.label}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent
            style={{ backgroundColor: "#000000", border: "1px solid #333" }}
            className="text-xs p-2"
          >
            <p className="font-semibold text-white">7-Day Momentum: {r.insMomentum}</p>
            <p className="text-zinc-400 mt-1">Compares 7-day return vs prior 7-day return. Detects acceleration.</p>
          </TooltipContent>
        </Tooltip>
      </td>

      {/* COS */}
      <td className="py-3 px-3 text-center hidden lg:table-cell">
        <span className={cn("font-mono text-sm font-bold tabular-nums", scoreColor(r.cos))}>{r.cos}</span>
      </td>

      {/* GVS */}
      <td className="py-3 px-3 text-center hidden xl:table-cell">
        <span className={cn("font-mono text-sm font-bold tabular-nums", scoreColor(r.gvs))}>{r.gvs}</span>
      </td>

      {/* VQS */}
      <td className="py-3 px-3 text-center hidden xl:table-cell">
        <span className={cn("font-mono text-sm font-bold tabular-nums", scoreColor(r.vqs))}>{r.vqs}</span>
      </td>

      {/* Signal / Alert */}
      {showAll && (
        <td className="py-3 px-4 hidden lg:table-cell">
          <div className="space-y-1.5">
            <div className="text-xs text-zinc-500 truncate max-w-[200px]">{r.insLabel}</div>
            {hasAlert && alertStr && (
              <span className={cn(
                "text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border inline-block",
                alertChipStyle(alertStr)
              )}>
                {alertStr}
              </span>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export function ScannerPage() {
  const [filter,  setFilter]  = useState<ScanFilter>("all");
  const [showAll, setShowAll] = useState(false);

  const queryClient = useQueryClient();

  const { data } = useGetScanner<ScannerResponse>({
    query: {
      queryKey:       getGetScannerQueryKey(),
      refetchInterval: 10_000,
    },
  });

  const { mutate: doRefresh, isPending: refreshPending } = useRefreshScanner({
    mutation: {
      onSuccess: () => {
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: getGetScannerQueryKey() });
        }, 1_200);
      },
    },
  });

  const status      = data?.status ?? "idle";
  const progress    = data?.progress;
  const lastScanMs  = data?.lastScanTime ?? 0;
  const allResults  = data?.results ?? [];
  const filtered    = applyFilter(allResults, filter);
  const displayed   = showAll ? filtered : filtered.slice(0, 25);

  const lastUpdated = lastScanMs
    ? new Date(lastScanMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : null;

  const isBusy = refreshPending || status === "loading";

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-400 shrink-0" />
            INS Market Scanner
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {status === "loading" && progress
              ? `Scanning additional tickers… ${progress.done}/${progress.total}`
              : status === "complete"
              ? `${allResults.length} stocks ranked · last updated ${lastUpdated ?? "—"}`
              : "Warming up — first scan starts shortly…"}
          </p>
        </div>

        <button
          onClick={() => doRefresh()}
          disabled={isBusy}
          className={cn(
            "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border shrink-0 transition-colors",
            "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200",
            isBusy && "opacity-40 cursor-not-allowed pointer-events-none"
          )}
        >
          <RefreshCw className={cn("w-3 h-3", isBusy && "animate-spin")} />
          {isBusy ? "Scanning…" : "Refresh Scan"}
        </button>
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      {status === "loading" && progress && progress.total > 0 && (
        <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden -mt-2">
          <div
            className="h-full bg-violet-500 transition-all duration-700 ease-out"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest hidden sm:block">Filter</span>
        {FILTERS.map(f => (
          <button
            key={f.key}
            title={f.desc}
            onClick={() => setFilter(f.key)}
            className={cn(
              "text-xs font-medium px-3 py-1 rounded border transition-colors duration-150",
              filter === f.key ? f.active : f.base
            )}
          >
            {f.label}
          </button>
        ))}
        {filter !== "all" && (
          <span className="text-xs text-zinc-500">{filtered.length} match{filtered.length !== 1 ? "es" : ""}</span>
        )}
      </div>

      {/* ── Idle / empty state ──────────────────────────────────────────────── */}
      {status === "idle" && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Zap className="w-12 h-12 mb-4 opacity-10" />
          <p className="text-sm font-medium">Scanner warming up</p>
          <p className="text-xs opacity-60 mt-1 text-center max-w-xs">
            First scan starts 10 seconds after startup and takes ~4 minutes to complete.
          </p>
        </div>
      )}

      {status !== "idle" && allResults.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      )}

      {/* ── Results table ───────────────────────────────────────────────────── */}
      {allResults.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3 text-center w-10">#</th>
                  <th className="py-2.5 px-4">Ticker</th>
                  <th className="py-2.5 px-3 text-center text-violet-400">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help underline decoration-dotted underline-offset-2">INS</span>
                      </TooltipTrigger>
                      <TooltipContent
                        style={{ backgroundColor: "#000000", border: "1px solid #333" }}
                        className="text-xs p-2 max-w-xs"
                      >
                        <p className="text-violet-300 font-semibold">Inflection Signal Score</p>
                        <p className="text-zinc-400 mt-1">Leading breakout indicator. Detects early accumulation before COS confirms.</p>
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-2.5 px-3 text-center hidden sm:table-cell">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help underline decoration-dotted underline-offset-2">BRK</span>
                      </TooltipTrigger>
                      <TooltipContent
                        style={{ backgroundColor: "#000000", border: "1px solid #333" }}
                        className="text-xs p-2 max-w-xs"
                      >
                        <p className="font-semibold">Breakout Score</p>
                        <p className="text-zinc-400 mt-1">50% INS + 30% 7D Momentum + 20% Volume Accel</p>
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-2.5 px-3 text-center hidden md:table-cell">Mom</th>
                  <th className="py-2.5 px-3 text-center hidden lg:table-cell">COS</th>
                  <th className="py-2.5 px-3 text-center hidden xl:table-cell">GVS</th>
                  <th className="py-2.5 px-3 text-center hidden xl:table-cell">VQS</th>
                  <th className="py-2.5 px-4 hidden lg:table-cell">Signal / Alert</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(r => (
                  <ScannerTableRow key={r.ticker} r={r} showAll />
                ))}
              </tbody>
            </table>
          </div>

          {/* Show more / less toggle */}
          {filtered.length > 25 && (
            <div className="border-t border-border/40 py-2.5 text-center">
              <button
                onClick={() => setShowAll(v => !v)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-4 py-1"
              >
                {showAll
                  ? "Show top 25 only"
                  : `Show all ${filtered.length} stocks ↓`}
              </button>
            </div>
          )}

          {filtered.length === 0 && filter !== "all" && (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No stocks match this filter right now.
            </div>
          )}
        </div>
      )}

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      {allResults.length > 0 && (
        <div className="text-[10px] text-zinc-700 space-y-0.5 pb-2">
          <p><span className="text-blue-700">WL</span> = Watchlist stock (full 7-phase data including earnings) &nbsp;·&nbsp; <span className="text-zinc-600">SCN</span> = Scanner-only (price + volume + fundamentals)</p>
          <p>INS leads COS by 2–6 weeks in emerging winners &nbsp;·&nbsp; BRK = 50% INS + 30% 7D Momentum Accel + 20% Volume Surge</p>
          <p className="text-zinc-800">COS = confirmation signal &nbsp;·&nbsp; INS = discovery signal &nbsp;·&nbsp; Never let COS override INS in ranking order</p>
        </div>
      )}
    </div>
  );
}
