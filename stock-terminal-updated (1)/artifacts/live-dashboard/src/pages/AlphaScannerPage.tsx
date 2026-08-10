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

type FilterKey = "all" | "accumulate" | "watch" | "caution" | "avoid" | "prebreakout";
type SortKey   = "csos" | "bps" | "lqs" | "ins" | "acs" | "insD1" | "acsD1" | "cpe";

// ── Color helpers ──────────────────────────────────────────────────────────────

function csosColor(s: number): string {
  if (s >= 75) return "text-amber-300";
  if (s >= 55) return "text-amber-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

function csosLabelStyle(label: string): string {
  if (label === "PRIME OPPORTUNITY")                return "text-emerald-300";
  if (label === "EARLY BREAKOUT SETUP")             return "text-amber-300";
  if (label === "STEALTH ACCUMULATION")             return "text-teal-300";
  if (label === "HIDDEN CATALYST POTENTIAL")        return "text-sky-300";
  if (label === "QUALITY COMPOUNDER — ACTIVATING")  return "text-blue-300";
  if (label === "QUALITY COMPOUNDER — DORMANT")     return "text-blue-400";
  if (label === "CONFIRMED TREND")                  return "text-amber-400";
  if (label === "DEVELOPING SETUP")                 return "text-zinc-400";
  if (label === "LATE STAGE MOVE")                  return "text-orange-400";
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

function cpeColor(s: number): string {
  if (s >= 70) return "text-sky-300";
  if (s >= 50) return "text-sky-400/80";
  if (s >= 35) return "text-sky-500/70";
  return "text-zinc-500";
}

function bpsColor(s: number): string {
  if (s >= 75) return "text-amber-300";
  if (s >= 55) return "text-amber-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

function lqsColor(s: number): string {
  if (s >= 75) return "text-emerald-300";
  if (s >= 55) return "text-emerald-400";
  if (s >= 35) return "text-yellow-500";
  return "text-red-400";
}

function bpsLabel(s: number): string {
  if (s >= 80) return "STRONG SETUP";
  if (s >= 65) return "BUILDING";
  if (s >= 50) return "DEVELOPING";
  if (s >= 35) return "WEAK";
  return "NO SETUP";
}

function lqsLabel(s: number): string {
  if (s >= 80) return "ELITE COMPOUNDER";
  if (s >= 65) return "HIGH QUALITY";
  if (s >= 50) return "SOLID";
  if (s >= 35) return "MIXED";
  return "LOW QUALITY";
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

function DeltaChip({ v, label = "1D" }: { v: number | null | undefined; label?: string }) {
  if (v == null || v === 0) return null;
  const pos = v > 0;
  return (
    <span className={cn("text-[9px] font-semibold tabular-nums leading-none", pos ? "text-emerald-400" : "text-red-400")}>
      {pos ? "+" : ""}{v}
      <span className="opacity-50 font-normal"> {label}</span>
    </span>
  );
}

function formatBaselineAge(ms: number): string {
  if (ms >= 23 * 3600_000) return "1D";
  if (ms >= 3600_000) return `${Math.round(ms / 3600_000)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

type SigKey = "ins" | "acs" | "cos" | "csos" | "cpe";

/** Best available single delta: 1D → 1H → baseline. Skips zeros. */
function resolveDelta(
  delta: SignalDelta | undefined,
  key: SigKey,
): { v: number | null; label: string } {
  if (!delta) return { v: null, label: "" };
  const v1D = (delta.delta1D as Record<string, number> | null | undefined)?.[key] ?? null;
  if (v1D !== null && v1D !== 0) return { v: v1D, label: "1D" };
  const v1H = (delta.delta1H as Record<string, number> | null | undefined)?.[key] ?? null;
  if (v1H !== null && v1H !== 0) return { v: v1H, label: "1H" };
  const vB  = (delta.deltaBaseline as Record<string, number> | null | undefined)?.[key] ?? null;
  if (vB !== null && vB !== 0 && delta.baselineAgeMs != null)
    return { v: vB, label: formatBaselineAge(delta.baselineAgeMs) };
  return { v: null, label: "" };
}

/** All available CSOS chips: 1H/baseline slot, 1D slot, 7D slot. */
function resolveCsosChips(
  delta: SignalDelta | undefined,
): Array<{ v: number; label: string }> {
  if (!delta) return [];
  const chips: Array<{ v: number; label: string }> = [];
  const v1H = (delta.delta1H as Record<string, number> | null | undefined)?.["csos"] ?? null;
  if (v1H !== null && v1H !== 0) {
    chips.push({ v: v1H, label: "1H" });
  } else {
    const vB = (delta.deltaBaseline as Record<string, number> | null | undefined)?.["csos"] ?? null;
    if (vB !== null && vB !== 0 && delta.baselineAgeMs != null)
      chips.push({ v: vB, label: formatBaselineAge(delta.baselineAgeMs) });
  }
  const v1D = (delta.delta1D as Record<string, number> | null | undefined)?.["csos"] ?? null;
  if (v1D !== null && v1D !== 0) chips.push({ v: v1D, label: "1D" });
  const v7D = (delta.delta7D as Record<string, number> | null | undefined)?.["csos"] ?? null;
  if (v7D !== null && v7D !== 0) chips.push({ v: v7D, label: "7D" });
  return chips;
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

// ── Per-stock analytical verdict ──────────────────────────────────────────────

interface Verdict {
  action:          string;
  actionStyle:     string;
  actionBg:        string;
  confidence:      "HIGH" | "MEDIUM" | "LOW";
  reasons:         string[];
  risks:           string[];
  entryNote:       string | null;
  // Enhanced quant briefing fields
  setupClass:      string;
  setupStage:      string;
  bpsInterpret:    string;
  lqsInterpret:    string;
  alignedSignals:  string[];
  conflictSignals: string[];
  riskRewardTag:   string;
  regimeFit:       string;
}

function confColor(c: "HIGH" | "MEDIUM" | "LOW"): string {
  if (c === "HIGH")   return "text-emerald-400";
  if (c === "MEDIUM") return "text-yellow-400";
  return "text-zinc-500";
}

function buildVerdict(score: StockScore, delta: SignalDelta | undefined): Verdict {
  const ins      = score.ins  ?? 50;
  const acs      = score.acs;
  const cos      = score.cos;
  const vqs      = score.vqs;
  const gvs      = score.gvs;
  const fbrs     = score.fbrs ?? 50;
  const csos     = score.csos;
  const cpe      = score.cpe ?? 50;
  const bps      = score.bps ?? 50;
  const lqs      = score.lqs ?? 50;
  const label    = score.csosLabel ?? "";
  const insD1    = (delta?.delta1D as Record<string, number> | null | undefined)?.ins ?? 0;
  const acsD1    = (delta?.delta1D as Record<string, number> | null | undefined)?.acs ?? 0;
  const cosD1    = (delta?.delta1D as Record<string, number> | null | undefined)?.cos ?? 0;
  const insTrend = delta?.trends?.ins ?? "FLAT";
  const acsTrend = delta?.trends?.acs ?? "FLAT";
  const divFlag  = delta?.divergence ?? "";

  // ── Action classification ─────────────────────────────────────────────────
  let action:      string;
  let actionStyle: string;
  let actionBg:    string;
  let confidence:  "HIGH" | "MEDIUM" | "LOW";
  let entryNote:   string | null = null;

  if (vqs < 40) {
    action = "AVOID"; actionStyle = "text-red-300"; actionBg = "bg-red-900/40 border-red-700";
    confidence = "HIGH";
    entryNote = "Fundamentally weak business — signals are unreliable regardless of price action.";
  } else if (label === "LATE STAGE MOVE" || (cos > 78 && ins < 48)) {
    action = "TRIM / REDUCE"; actionStyle = "text-orange-300"; actionBg = "bg-orange-900/40 border-orange-700";
    confidence = cos > 82 ? "HIGH" : "MEDIUM";
    entryNote = "The easy money has been made. Risk/reward is poor for new entries — COS extended, INS fading.";
  } else if (label === "PRIME OPPORTUNITY" || score.isSuperstock) {
    action = "BUILD POSITION"; actionStyle = "text-emerald-300"; actionBg = "bg-emerald-900/40 border-emerald-700";
    confidence = "HIGH";
    entryNote = "All signals aligned — enter with full conviction. Scale in over 2–3 sessions.";
  } else if (label === "EARLY BREAKOUT SETUP" || (ins >= 72 && acs >= 60 && fbrs < 50 && cos < 65)) {
    action = "ACCUMULATE"; actionStyle = "text-amber-300"; actionBg = "bg-amber-900/40 border-amber-700";
    confidence = ins >= 80 && acs >= 65 ? "HIGH" : "MEDIUM";
    entryNote = "INS front-running COS — pre-consensus entry window. Build starter now; add as COS confirms.";
  } else if (label === "STEALTH ACCUMULATION") {
    action = "INITIATE / MONITOR"; actionStyle = "text-teal-300"; actionBg = "bg-teal-900/40 border-teal-700";
    confidence = "MEDIUM";
    entryNote = "Smart money loading quietly. Small starter — full commitment on INS breakout above 70.";
  } else if (label === "HIDDEN CATALYST POTENTIAL") {
    action = "INITIATE / MONITOR"; actionStyle = "text-sky-300"; actionBg = "bg-sky-900/40 border-sky-700";
    confidence = "MEDIUM";
    entryNote = "Elevated catalyst probability, no momentum confirmation yet. Small starter; wait for INS or ACS.";
  } else if (label === "CONFIRMED TREND" && cos < 78) {
    action = "HOLD / ADD"; actionStyle = "text-sky-300"; actionBg = "bg-sky-900/40 border-sky-700";
    confidence = ins >= 60 ? "MEDIUM" : "LOW";
    entryNote = "Move confirmed, mid-stage. Existing: hold. New entries: small size, stop under structure.";
  } else if (label === "QUALITY COMPOUNDER — ACTIVATING") {
    action = "ACCUMULATE"; actionStyle = "text-amber-300"; actionBg = "bg-amber-900/40 border-amber-700";
    confidence = "MEDIUM";
    entryNote = "Strong fundamentals + INS now live. VQS is your margin of safety on entry risk.";
  } else if (label === "QUALITY COMPOUNDER — DORMANT") {
    action = "WATCHLIST — AWAIT INS"; actionStyle = "text-blue-300"; actionBg = "bg-blue-900/40 border-blue-700";
    confidence = "LOW";
    entryNote = "High-quality business, no timing signal yet. Wait for INS to break above 60.";
  } else if (csos >= 35 && (insD1 > 0 || acsD1 > 0 || cpe >= 65)) {
    action = "MONITOR — SIGNALS BUILDING"; actionStyle = "text-zinc-300"; actionBg = "bg-zinc-800 border-zinc-600";
    confidence = "LOW";
    entryNote = "Signals starting to move. Watch 2–3 more snapshots for acceleration before committing.";
  } else if (csos >= 35) {
    action = "MONITOR"; actionStyle = "text-zinc-400"; actionBg = "bg-zinc-800 border-zinc-700";
    confidence = "LOW";
    entryNote = "No actionable entry signal. Revisit if INS, ACS, or BPS start to climb.";
  } else {
    action = "PASS"; actionStyle = "text-red-400"; actionBg = "bg-zinc-900 border-zinc-700";
    confidence = "LOW";
    entryNote = null;
  }

  if (fbrs > 70 && !["AVOID", "TRIM / REDUCE", "PASS"].includes(action)) {
    action      = "CAUTION — " + action;
    actionStyle = "text-orange-300";
    actionBg    = "bg-orange-900/40 border-orange-700";
    confidence  = confidence === "HIGH" ? "MEDIUM" : "LOW";
    entryNote   = `⚠ High false-breakout risk (FBRS ${fbrs}). Size half-normal, keep stops tight. ` + (entryNote ?? "");
  }

  // ── Signal alignment ──────────────────────────────────────────────────────
  const alignedSignals:  string[] = [];
  const conflictSignals: string[] = [];

  if (ins >= 65)  alignedSignals.push(`INS ${ins} — strong breakout signal`);
  else if (ins >= 50) alignedSignals.push(`INS ${ins} — developing`);
  else            conflictSignals.push(`INS ${ins} — weak leading indicator`);

  if (acs >= 60)  alignedSignals.push(`ACS ${acs} — institutional accumulation confirmed`);
  else if (acs >= 45) alignedSignals.push(`ACS ${acs} — accumulation building`);
  else            conflictSignals.push(`ACS ${acs} — no institutional backing`);

  if (bps >= 65)  alignedSignals.push(`BPS ${bps} — breakout setup well-formed`);
  else if (bps >= 50) alignedSignals.push(`BPS ${bps} — setup developing`);
  else            conflictSignals.push(`BPS ${bps} — setup not yet in place`);

  if (lqs >= 65)  alignedSignals.push(`LQS ${lqs} — strong quality foundation`);
  else if (lqs >= 50) alignedSignals.push(`LQS ${lqs} — adequate quality`);
  else            conflictSignals.push(`LQS ${lqs} — below-average business quality`);

  if (fbrs < 40)  alignedSignals.push(`FBRS ${fbrs} — clean institutional setup (low hype risk)`);
  else if (fbrs > 65) conflictSignals.push(`FBRS ${fbrs} — elevated false-breakout risk`);

  // ── Setup classification ──────────────────────────────────────────────────
  let setupClass = "Developing Setup";
  if (score.isSuperstock) {
    setupClass = "Superstock Candidate · All-Signal Alignment";
  } else if (label === "PRIME OPPORTUNITY") {
    setupClass = "Full Convergence · Highest Conviction";
  } else if (label === "EARLY BREAKOUT SETUP") {
    setupClass = "Pre-Consensus Breakout · INS Leading";
  } else if (label === "STEALTH ACCUMULATION") {
    setupClass = "Smart-Money Build · Pre-Public Entry";
  } else if (label === "HIDDEN CATALYST POTENTIAL") {
    setupClass = "Asymmetric Setup · Catalyst Unpriced";
  } else if (label.startsWith("QUALITY COMPOUNDER")) {
    setupClass = "Fundamentals-Driven · LQS Anchor";
  } else if (label === "CONFIRMED TREND") {
    setupClass = "Breakout Confirmed · Mid-Stage";
  } else if (label === "LATE STAGE MOVE") {
    setupClass = "Late-Cycle · Risk/Reward Degraded";
  } else if (label === "LOW QUALITY / AVOID") {
    setupClass = "Fundamental Override · No Edge";
  }

  // ── Setup stage ───────────────────────────────────────────────────────────
  let setupStage = "—";
  if (ins > cos + 15 && cos < 65)     setupStage = "EARLY — Pre-Consensus Window";
  else if (ins >= 60 && cos >= 55 && cos < 75) setupStage = "MID — Breakout Confirming";
  else if (cos >= 75 && ins >= 55)    setupStage = "LATE-MID — Extended, Watch Closely";
  else if (cos > 78 && ins < 52)      setupStage = "LATE — Overextended, Exit Risk";
  else if (ins < 50 && cos < 50)      setupStage = "RESET — No Active Setup";
  else if (ins >= 50 && cos < 50)     setupStage = "IGNITION — Very Early Stage";

  // ── BPS interpretation ────────────────────────────────────────────────────
  let bpsInterpret: string;
  if (bps >= 80) {
    bpsInterpret = `BPS ${bps} — Breakout conditions are excellent. INS, ACS, and trend structure all confirm a high-probability near-term move.`;
  } else if (bps >= 65) {
    bpsInterpret = `BPS ${bps} — Solid breakout setup. Most signal components aligned — watch for INS to cross 70 as the trigger.`;
  } else if (bps >= 50) {
    bpsInterpret = `BPS ${bps} — Developing. Setup is not yet mature — some components aligned, others lagging. Monitor for acceleration.`;
  } else if (bps >= 35) {
    bpsInterpret = `BPS ${bps} — Weak near-term setup. INS and/or ACS below the threshold needed to justify a breakout trade.`;
  } else {
    bpsInterpret = `BPS ${bps} — No breakout setup present. Signals are absent or conflicting — avoid timing-based entries here.`;
  }

  // ── LQS interpretation ────────────────────────────────────────────────────
  let lqsInterpret: string;
  if (lqs >= 80) {
    lqsInterpret = `LQS ${lqs} — Elite compounder quality. Strong revenue growth, wide margins, clean balance sheet, and reasonable valuation. This is a business worth owning for years.`;
  } else if (lqs >= 65) {
    lqsInterpret = `LQS ${lqs} — High-quality business. Above-average fundamentals provide a strong margin of safety on any entry.`;
  } else if (lqs >= 50) {
    lqsInterpret = `LQS ${lqs} — Adequate quality. Business is solid but not exceptional — higher conviction required on timing signals.`;
  } else if (lqs >= 35) {
    lqsInterpret = `LQS ${lqs} — Mixed fundamentals. Some weak areas (margins, growth, or balance sheet) reduce long-term holding confidence.`;
  } else {
    lqsInterpret = `LQS ${lqs} — Low business quality. Weak margins, inconsistent growth, or leverage concerns make this a speculative hold only.`;
  }

  // ── Risk / reward tag ─────────────────────────────────────────────────────
  let riskRewardTag: string;
  if (bps >= 70 && lqs >= 65 && fbrs < 45) {
    riskRewardTag = "Excellent — high breakout probability with quality anchor";
  } else if (bps >= 60 && lqs >= 55 && fbrs < 60) {
    riskRewardTag = "Favorable — setup developing with reasonable fundamentals";
  } else if (fbrs > 65) {
    riskRewardTag = "Skewed by hype risk — reduce size, tighten stop";
  } else if (cos > 75 && ins < 55) {
    riskRewardTag = "Poor — late-stage, chasing a move already made";
  } else if (lqs < 40) {
    riskRewardTag = "Speculative — no fundamental safety net";
  } else {
    riskRewardTag = "Neutral — wait for cleaner signal convergence";
  }

  // ── Regime fit ────────────────────────────────────────────────────────────
  let regimeFit: string;
  const tl = score.trendLabel ?? "";
  if (tl === "LONG-TERM LEADER") {
    regimeFit = "Long-term leader with multi-timeframe trend confirmed — holds well in most regimes";
  } else if (tl === "MID-TERM BREAKOUT") {
    regimeFit = "Mid-term breakout — best in RISK-ON or QUALITY GROWTH regime; requires caution in volatile markets";
  } else if (tl === "SHORT-TERM IGNITION") {
    regimeFit = "Short-term ignition — high-risk, high-reward; works best in RISK-ON; fade quickly in DEFENSIVE";
  } else {
    regimeFit = "No trend structure — regime fit is poor; avoid momentum entries";
  }

  // ── Supporting signals ────────────────────────────────────────────────────
  const reasons: string[] = [];

  if (ins >= 70) {
    reasons.push(`INS ${ins}${insD1 > 0 ? ` (+${insD1} today)` : ""} — strong breakout signal leading the crowd`);
  } else if (ins >= 55) {
    reasons.push(`INS ${ins}${insD1 > 0 ? ` (+${insD1} today)` : ""} — momentum building, watch for >70 cross`);
  } else if (insTrend === "STRONGLY_RISING" || insTrend === "RISING") {
    reasons.push(`INS ${ins} rising from low base${insD1 > 0 ? ` (+${insD1} today)` : ""} — early inflection`);
  }

  if (acs >= 65) {
    reasons.push(`ACS ${acs}${acsD1 > 0 ? ` (+${acsD1} today)` : ""} — institutional accumulation: smart money loading`);
  } else if (acs >= 50 && (acsD1 > 0 || acsTrend === "RISING" || acsTrend === "STRONGLY_RISING")) {
    reasons.push(`ACS ${acs} rising${acsD1 > 0 ? ` (+${acsD1} today)` : ""} — accumulation trend building`);
  }

  if (ins > cos + 10 && cos < 72) {
    reasons.push(`INS (${ins}) leads COS (${cos}) by ${ins - cos} pts — pre-consensus window, crowd not yet pricing this`);
  } else if (cos >= 65 && ins >= 60) {
    reasons.push(`INS ${ins} + COS ${cos} co-elevated — breakout confirmed and holding`);
  }

  if (vqs >= 65) reasons.push(`VQS ${vqs} — ${score.vqsLabel}: strong fundamental base`);
  if (gvs >= 65) reasons.push(`GVS ${gvs} — ${score.gvsLabel}`);
  if (cpe >= 65) reasons.push(`CPE ${cpe} — elevated catalyst probability: market likely underpricing a re-rating`);
  if (score.isSuperstock) reasons.push("Superstock candidate — INS, ACS, FBRS all at elite thresholds simultaneously");

  if (divFlag === "EARLY IGNITION SETUP") {
    reasons.push("Signal flag: EARLY IGNITION — INS and ACS both accelerating before COS confirms");
  } else if (divFlag === "INSTITUTIONAL ACCUMULATION BEFORE REPRICING") {
    reasons.push("Signal flag: INSTITUTIONAL ACCUMULATION — quiet smart-money positioning before public catalyst");
  }

  if (cosD1 > 0 && insD1 > 0) {
    reasons.push(`Both INS and COS moving up today (+${insD1} / +${cosD1}) — multi-signal acceleration`);
  }

  // ── Risks & concerns ─────────────────────────────────────────────────────
  const risks: string[] = [];

  if (fbrs > 50) {
    risks.push(`FBRS ${fbrs} — ${fbrs > 70 ? "high" : "moderate"} false-breakout risk: ${fbrs > 70 ? "hype-driven move likely to reverse; ACS confirmation is mandatory before sizing up" : "verify with ACS before adding to position"}`);
  }
  if (cos > 72 && ins < 55) {
    risks.push(`Late-stage pattern: COS (${cos}) has run ahead of INS (${ins}) — the crowd is now in, edge is gone`);
  }
  if (vqs < 55 && vqs >= 40) {
    risks.push(`VQS ${vqs} — below-average fundamentals reduce margin of safety; be selective on entry`);
  }
  if (insTrend === "FALLING" || insTrend === "STRONGLY_FALLING") {
    risks.push(`INS trend is ${insTrend === "STRONGLY_FALLING" ? "sharply" : ""} falling — breakout signal weakening; review thesis`);
  }
  if (acs < 45 && ins >= 65) {
    risks.push(`ACS ${acs} absent despite INS ${ins} — signal divergence: no institutional confirmation of the move`);
  }
  if (lqs < 40) {
    risks.push(`LQS ${lqs} — low business quality: speculative hold only, no fundamental safety net`);
  }
  if (score.debtToEquity && score.debtToEquity > 2.5) {
    risks.push(`Leverage risk: D/E ${score.debtToEquity.toFixed(1)}x — high debt amplifies downside in a rate-rising or revenue-miss scenario`);
  }
  if (score.fcfMargin && score.fcfMargin < -10) {
    risks.push(`FCF margin ${score.fcfMargin.toFixed(0)}% — burning cash; runway matters, especially if growth decelerates`);
  }
  if (divFlag === "LATE CYCLE / EXHAUSTION RISK") {
    risks.push("Signal flag: LATE CYCLE / EXHAUSTION — COS extended + INS declining; avoid new entries, consider exit plan");
  } else if (divFlag === "SPECULATIVE MOMENTUM (UNCONFIRMED)") {
    risks.push("Signal flag: SPECULATIVE MOMENTUM — INS moved but no ACS or COS confirmation; size conservatively");
  }
  if (cpe < 30) {
    risks.push(`CPE ${cpe} — very low catalyst probability: no evidence of an approaching re-rating event`);
  }

  if (risks.length === 0 && !["AVOID", "PASS", "TRIM / REDUCE", "MONITOR"].includes(action)) {
    risks.push("No major red flags — setup is clean across all signal dimensions");
  }
  if (risks.length === 0 && action === "MONITOR") {
    risks.push("No actionable entry signal yet — signals are present but below conviction thresholds");
  }

  return {
    action, actionStyle, actionBg, confidence, reasons, risks, entryNote,
    setupClass, setupStage, bpsInterpret, lqsInterpret,
    alignedSignals, conflictSignals, riskRewardTag, regimeFit,
  };
}

function AnalysisTooltip({ row }: { row: RowData }) {
  const verdict = buildVerdict(row.score, row.delta);
  const bps = row.score.bps ?? 0;
  const lqs = row.score.lqs ?? 0;
  const alignOk  = verdict.alignedSignals.length;
  const alignFail = verdict.conflictSignals.length;
  const totalSig  = alignOk + alignFail;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="font-bold text-sm text-zinc-100 cursor-help underline decoration-dotted decoration-zinc-600 underline-offset-2">
          {row.ticker}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        sideOffset={10}
        className="p-0 overflow-hidden border border-zinc-700 shadow-2xl rounded-lg text-left z-50 w-[360px]"
        style={{ backgroundColor: "#000000" }}
      >
        {/* ── Header: action + confidence ── */}
        <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800" style={{ backgroundColor: "#0f0f0f" }}>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
              {row.ticker} · Quant Briefing
            </span>
            <span className={cn("text-[8px] font-bold uppercase tracking-wide", confColor(verdict.confidence))}>
              {verdict.confidence} CONF.
            </span>
          </div>
          <div className="flex items-start gap-2 flex-wrap mb-1.5">
            <div className={cn(
              "text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded border inline-block leading-none shrink-0",
              verdict.actionBg, verdict.actionStyle,
            )}>
              {verdict.action}
            </div>
            <span className="text-[9px] text-zinc-500 leading-snug self-center">{verdict.setupClass}</span>
          </div>
          {verdict.entryNote && (
            <p className="text-[10px] text-zinc-400 leading-snug">{verdict.entryNote}</p>
          )}
        </div>

        {/* ── BPS + LQS score panel ── */}
        <div className="px-3 py-2 border-b border-zinc-800/60 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[8px] uppercase tracking-widest text-zinc-600 mb-1 font-bold">Breakout Probability</div>
            <div className="flex items-baseline gap-1.5 mb-0.5">
              <span className={cn("font-black text-xl tabular-nums leading-none", bpsColor(bps))}>{bps}</span>
              <span className={cn("text-[8px] font-bold uppercase", bpsColor(bps))}>{bpsLabel(bps)}</span>
            </div>
            <p className="text-[9px] text-zinc-500 leading-snug">{verdict.bpsInterpret}</p>
          </div>
          <div>
            <div className="text-[8px] uppercase tracking-widest text-zinc-600 mb-1 font-bold">Quality Foundation</div>
            <div className="flex items-baseline gap-1.5 mb-0.5">
              <span className={cn("font-black text-xl tabular-nums leading-none", lqsColor(lqs))}>{lqs}</span>
              <span className={cn("text-[8px] font-bold uppercase", lqsColor(lqs))}>{lqsLabel(lqs)}</span>
            </div>
            <p className="text-[9px] text-zinc-500 leading-snug">{verdict.lqsInterpret}</p>
          </div>
        </div>

        {/* ── Setup intelligence: stage + regime fit + risk/reward ── */}
        <div className="px-3 py-2 border-b border-zinc-800/60 space-y-1.5">
          <div className="text-[8px] uppercase tracking-widest text-zinc-600 font-bold">Setup Intelligence</div>
          {verdict.setupStage !== "—" && (
            <div className="flex items-start gap-1.5">
              <span className="text-[8px] text-zinc-600 shrink-0 w-[60px] leading-snug font-medium">STAGE</span>
              <span className="text-[9px] text-zinc-300 leading-snug">{verdict.setupStage}</span>
            </div>
          )}
          <div className="flex items-start gap-1.5">
            <span className="text-[8px] text-zinc-600 shrink-0 w-[60px] leading-snug font-medium">R/R</span>
            <span className="text-[9px] text-zinc-300 leading-snug">{verdict.riskRewardTag}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="text-[8px] text-zinc-600 shrink-0 w-[60px] leading-snug font-medium">REGIME</span>
            <span className="text-[9px] text-zinc-300 leading-snug">{verdict.regimeFit}</span>
          </div>
          {totalSig > 0 && (
            <div className="flex items-start gap-1.5">
              <span className="text-[8px] text-zinc-600 shrink-0 w-[60px] leading-snug font-medium">ALIGN</span>
              <span className={cn("text-[9px] font-semibold leading-snug",
                alignOk >= 4 ? "text-emerald-400" : alignOk >= 3 ? "text-yellow-400" : "text-orange-400"
              )}>
                {alignOk}/{totalSig} signals aligned
              </span>
            </div>
          )}
        </div>

        {/* ── Supporting signals ── */}
        {verdict.reasons.length > 0 && (
          <div className="px-3 py-2 border-b border-zinc-800/60">
            <div className="text-[8px] uppercase tracking-widest text-zinc-600 mb-1.5 font-bold">
              Supporting Signals
            </div>
            {verdict.reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 mb-1 last:mb-0">
                <span className="text-emerald-500 text-[9px] shrink-0 mt-px font-bold">✓</span>
                <span className="text-[10px] text-zinc-300 leading-snug">{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Conflicts + risks ── */}
        {(verdict.conflictSignals.length > 0 || verdict.risks.length > 0) && (
          <div className="px-3 py-2">
            <div className="text-[8px] uppercase tracking-widest text-zinc-600 mb-1.5 font-bold">
              Risks & Signal Conflicts
            </div>
            {verdict.conflictSignals.map((r, i) => (
              <div key={`c${i}`} className="flex items-start gap-1.5 mb-1">
                <span className="text-yellow-500 text-[9px] shrink-0 mt-px font-bold">⚡</span>
                <span className="text-[10px] text-zinc-400 leading-snug">{r}</span>
              </div>
            ))}
            {verdict.risks.map((r, i) => {
              const isClean = r.startsWith("No major");
              return (
                <div key={`r${i}`} className="flex items-start gap-1.5 mb-1 last:mb-0">
                  <span className={cn(
                    "text-[9px] shrink-0 mt-px font-bold",
                    isClean ? "text-emerald-500" : "text-orange-400",
                  )}>
                    {isClean ? "✓" : "!"}
                  </span>
                  <span className="text-[10px] text-zinc-300 leading-snug">{r}</span>
                </div>
              );
            })}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
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

// ── Filter logic ───────────────────────────────────────────────────────────────

const ACCUMULATE_ACTIONS = new Set(["BUILD POSITION", "ACCUMULATE"]);
const WATCH_ACTIONS      = new Set([
  "WATCHLIST — AWAIT INS",
  "INITIATE / MONITOR",
  "HOLD / ADD",
  "MONITOR — SIGNALS BUILDING",
  "MONITOR",
]);
const AVOID_ACTIONS      = new Set(["AVOID", "TRIM / REDUCE", "PASS"]);

const PRE_BREAKOUT_LABELS = new Set(["STEALTH ACCUMULATION", "HIDDEN CATALYST POTENTIAL"]);

function matchesFilter(row: RowData, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "prebreakout") return PRE_BREAKOUT_LABELS.has(row.score.csosLabel ?? "");
  const action = buildVerdict(row.score, row.delta).action;
  const isCAUTION = action.startsWith("CAUTION —");
  const base = isCAUTION ? action.slice("CAUTION — ".length) : action;
  switch (filter) {
    case "accumulate": return !isCAUTION && ACCUMULATE_ACTIONS.has(base);
    case "watch":      return !isCAUTION && WATCH_ACTIONS.has(base);
    case "caution":    return isCAUTION;
    case "avoid":      return !isCAUTION && AVOID_ACTIONS.has(base);
    default:           return true;
  }
}

// ── Sort logic ─────────────────────────────────────────────────────────────────

function sortRows(rows: RowData[], sortBy: SortKey): RowData[] {
  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "bps":   return (b.score.bps ?? 0) - (a.score.bps ?? 0);
      case "lqs":   return (b.score.lqs ?? 0) - (a.score.lqs ?? 0);
      case "ins":   return (b.score.ins ?? 0) - (a.score.ins ?? 0);
      case "acs":   return b.score.acs - a.score.acs;
      case "insD1": return (b.delta?.delta1D?.ins ?? 0) - (a.delta?.delta1D?.ins ?? 0);
      case "acsD1": return (b.delta?.delta1D?.acs ?? 0) - (a.delta?.delta1D?.acs ?? 0);
      case "cpe":   return (b.score.cpe ?? 50) - (a.score.cpe ?? 50);
      default:      return b.score.csos - a.score.csos;
    }
  });
}

// ── Filter bar config ──────────────────────────────────────────────────────────

const FILTERS: {
  key:   FilterKey;
  label: string;
  base:  string;
  active: string;
  tip:   { title: string; body: string; how: string };
}[] = [
  {
    key:    "all",
    label:  "All Stocks",
    base:   "border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200",
    active: "bg-zinc-700 border-zinc-500 text-white",
    tip: {
      title: "All Stocks",
      body:  "Shows every stock in the scanner ranked by CSOS. Use this to get the full picture before narrowing down with a verdict filter.",
      how:   "Scan the CSOS column top-to-bottom. Use the sort controls to re-rank by INS or ACS delta to surface the fastest-moving setups.",
    },
  },
  {
    key:    "accumulate",
    label:  "Accumulate",
    base:   "border-amber-700 text-amber-500 hover:border-amber-500 hover:text-amber-300",
    active: "border-amber-500 bg-amber-900/40 text-amber-200",
    tip: {
      title: "Accumulate — Actionable Entry",
      body:  "Stocks where the signal system says it is the right time to build or add to a position. Includes BUILD POSITION (all signals aligned, full conviction) and ACCUMULATE (INS front-running COS — early entry before the crowd confirms).",
      how:   "Hover each ticker for the full verdict. Prioritise stocks with rising ACS alongside high INS — those are the highest-conviction setups. Scale in over 2–3 sessions rather than entering all at once.",
    },
  },
  {
    key:    "watch",
    label:  "Watchlist",
    base:   "border-sky-700 text-sky-500 hover:border-sky-500 hover:text-sky-300",
    active: "border-sky-500 bg-sky-900/40 text-sky-200",
    tip: {
      title: "Watchlist — Not Yet, But Worth Tracking",
      body:  "Stocks with a developing setup that doesn't yet warrant a full position. Includes WATCHLIST — AWAIT INS (quality business waiting for a timing signal), INITIATE / MONITOR (small starter only), HOLD / ADD (move confirmed but mid-stage), and MONITOR — SIGNALS BUILDING (momentum just starting to stir).",
      how:   "Add these to your tracking list and watch for INS to cross 60–70 or ACS to start rising. A signal building flag on one of these names is an early warning to size up.",
    },
  },
  {
    key:    "caution",
    label:  "Caution",
    base:   "border-orange-700 text-orange-500 hover:border-orange-600 hover:text-orange-300",
    active: "border-orange-500 bg-orange-900/40 text-orange-200",
    tip: {
      title: "Caution — Elevated False-Breakout Risk",
      body:  "Stocks where FBRS (False Breakout Risk Score) is above 70. The underlying setup may still be valid, but the high FBRS means the move is more likely to be hype-driven and reverse quickly. The full verdict is shown after the CAUTION — prefix in the tooltip.",
      how:   "If you trade these, cut position size in half and keep stops tight. Wait for ACS to confirm before adding. Do not chase momentum alone on a CAUTION stock — institutional support (ACS) is your key confirmation signal.",
    },
  },
  {
    key:    "avoid",
    label:  "Avoid",
    base:   "border-red-800 text-red-500 hover:border-red-600 hover:text-red-300",
    active: "border-red-600 bg-red-900/40 text-red-200",
    tip: {
      title: "Avoid — No Edge or Exit Signal",
      body:  "Stocks the system says to skip or exit. Includes AVOID (fundamentally weak — VQS < 40), TRIM / REDUCE (late-stage, risk/reward has deteriorated), PASS (signals absent), and MONITOR (no actionable setup — watching only).",
      how:   "Do not initiate new positions here. For stocks you already hold that show TRIM / REDUCE, consider taking partial profits or tightening your stop. Check back when INS and CSOS start recovering.",
    },
  },
  {
    key:    "prebreakout",
    label:  "Pre-Breakout",
    base:   "border-violet-700 text-violet-400 hover:border-violet-500 hover:text-violet-200",
    active: "border-violet-500 bg-violet-900/40 text-violet-200",
    tip: {
      title: "Pre-Breakout — Hidden Catalyst & Stealth Accumulation",
      body:  "Stocks labeled STEALTH ACCUMULATION or HIDDEN CATALYST POTENTIAL. These are pre-move setups: COS is still low (the market hasn't priced the move yet), but CPE, INS, or ACS signal something is building underneath. Sorted by CPE — highest catalyst probability first.",
      how:   "These are your early-entry candidates. The lower COS means you're getting in before the crowd. Watch for INS starting to lift — that's the trigger. Keep position sizes moderate until COS confirms.",
    },
  },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "csos",  label: "CSOS"    },
  { key: "bps",   label: "BPS"     },
  { key: "lqs",   label: "LQS"     },
  { key: "ins",   label: "INS"     },
  { key: "acs",   label: "ACS"     },
  { key: "cpe",   label: "CPE"     },
  { key: "insD1", label: "INS Δ1D" },
  { key: "acsD1", label: "ACS Δ1D" },
];

// ── Main page ──────────────────────────────────────────────────────────────────

export function AlphaScannerPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<SortKey>("csos");
  const [searchTicker, setSearchTicker] = useState("");
  const [scanStatus, setScanStatus] = useState<SymbolScanState>("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [onDemandScan, setOnDemandScan] = useState<SymbolScanSuccess | null>(null);

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

  const onDemandRow = useMemo<RowData | undefined>(() => {
    if (!onDemandScan) return undefined;
    const { result } = onDemandScan;
    const liveQuote = quotesMap.get(result.ticker);
    return {
      ticker: result.ticker,
      company: result.company,
      categoryColor: "f59e0b",
      price: liveQuote?.price ?? result.quote.price,
      changePercent: liveQuote?.changePercent ?? result.quote.changePercent,
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
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">

      {/* ── Context panels ── */}
      <div className="px-4 pt-4 pb-3 space-y-2.5">
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
      </div>

      {/* ── Sticky filter + sort bar ── */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-2 flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <Tooltip key={f.key}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    setFilter(f.key);
                    // Auto-sort by CPE when entering pre-breakout view so the
                    // highest catalyst-probability stocks surface immediately.
                    // Revert to CSOS when leaving (unless user manually changed sort).
                    if (f.key === "prebreakout") setSortBy("cpe");
                    else if (filter === "prebreakout") setSortBy("csos");
                  }}
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
          <table className="w-full text-sm border-collapse min-w-[600px] sm:min-w-[820px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-800">
                <th className="px-3 py-2.5 text-center w-10 hidden sm:table-cell">#</th>
                <th className="px-4 py-2.5 text-left min-w-[170px]">Ticker</th>
                <th className="px-3 py-2.5 text-right">Price</th>

                {/* BPS + LQS hero column */}
                <th className="px-4 py-2.5 text-left min-w-[190px] sm:min-w-[230px]">
                  <ColHeader align="left" tip={
                    <div style={{ backgroundColor: "#000000", color: "#ffffff" }}>
                      <div className="px-3 py-2.5 border-b border-zinc-800" style={{ backgroundColor: "#0f0f0f" }}>
                        <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: "#f59e0b" }}>BPS · LQS — Dual Opportunity Lens</div>
                        <div className="text-[11px] text-zinc-300 leading-snug">
                          Two independent scores replace the single CSOS number. <strong className="text-amber-300">BPS</strong> answers "is this about to move?" — a near-term breakout setup detector. <strong className="text-emerald-300">LQS</strong> answers "is this a genuinely great business?" — a long-term fundamentals quality anchor. The contextual label below them (CSOS pattern) tells you WHY.
                        </div>
                      </div>
                      <div className="px-3 py-2 space-y-1.5">
                        {[
                          ["BPS 80+", "Excellent breakout setup: INS + ACS both elevated, clean FBRS, trending structure. High probability near-term move — highest-conviction entry window."],
                          ["BPS 65–79", "Good setup: most components aligned. Watch for INS to cross 70 as the trigger to size up."],
                          ["BPS 50–64", "Developing: signals building but not yet converged. Monitor, don't commit."],
                          ["BPS <50", "No setup: insufficient signal energy for a breakout trade."],
                          ["LQS 80+", "Elite compounder: strong revenue growth, wide margins, clean balance sheet, reasonable valuation. A business worth owning for years — BPS failure here is just a timing issue."],
                          ["LQS 65–79", "High quality: above-average fundamentals, meaningful margin of safety on any entry. Prioritise these when BPS is also elevated."],
                          ["LQS 50–64", "Adequate: solid but not exceptional — requires higher conviction on timing signals."],
                          ["LQS <50", "Speculative: fundamental weakness reduces holding confidence — trade only, don't invest."],
                          ["Label", "CSOS pattern label — context-aware description of the dominant signal regime. Read the tooltip on the ticker for full quant briefing."],
                        ].map(([band, meaning]) => (
                          <div key={band} className="flex items-start gap-2.5 text-[10px]">
                            <span className="font-mono text-zinc-500 shrink-0 w-[72px] leading-snug">{band}</span>
                            <span className="text-zinc-300 leading-snug">{meaning}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  }>
                    <span className="text-amber-400">BPS</span>
                    <span className="text-zinc-600 mx-1">·</span>
                    <span className="text-emerald-400">LQS</span>
                    <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">breakout · quality</span>
                  </ColHeader>
                </th>

                {/* CPE */}
                <th className="px-3 py-2.5 text-center">
                  <ColHeader tip={
                    <TipBody
                      title="CPE — Catalyst Probability Estimate"
                      color="#38bdf8"
                      desc="Measures the probability that a near-term catalyst will re-rate the stock. Combines accumulation intensity, valuation slack, EPS estimate trend, and institutional setup cleanliness. High CPE with low COS = market hasn't priced it yet. Best used alongside INS to confirm pre-breakout setups."
                      levels={[
                        ["70–100", "High catalyst probability. A re-rating event is plausible in the near term. Strongest when paired with rising INS and ACS."],
                        ["50–69",  "Moderate. Setup is developing but not yet confirmed. Monitor for INS acceleration."],
                        ["35–49",  "Low. Catalyst conditions are weak or absent. Do not act on CPE alone at this level."],
                        ["0–34",   "No catalyst signal. Wait for conditions to improve before considering entry."],
                        ["↑ trend", "Catalyst probability building. Combined with rising INS, this is a high-conviction pre-breakout signal."],
                        ["+N 1D Δ", "CPE improved N points since last snapshot — conditions are improving in real time."],
                      ]}
                    />
                  }>
                    <span className="text-sky-400">CPE</span>
                    <span className="text-zinc-700 ml-1 normal-case font-normal text-[9px]">trend · 1D</span>
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
                        ["75–100", "Strong breakout signal. High-conviction pre-consensus entry window. The signal is leading and not yet priced in."],
                        ["55–74",  "Momentum building. Watch closely for INS acceleration toward 75 — that crossing is the key event."],
                        ["35–54",  "Weak or early signal. Low conviction — monitor only, do not commit capital yet."],
                        ["0–34",   "No signal. Avoid until INS recovers. Chasing here typically results in buying right before a flat period."],
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
                        ["75–100", "Strong accumulation. Institutional buyers are building positions aggressively. This level alongside high INS is the EARLY IGNITION flag — highest-quality pre-breakout signal in the system."],
                        ["55–74",  "Moderate accumulation. Buying pressure is building — watch for follow-through and INS confirmation before sizing up."],
                        ["35–54",  "Weak or inconsistent. Some buying activity but not sustained. Do not act on ACS alone at this level."],
                        ["0–34",   "No accumulation signal. Smart money is not engaged. Without ACS support, any INS move has lower conviction."],
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
                        ["75–100", "High conviction — both quality fundamentals and price momentum are confirmed and elevated together. Breakout is mid-stage or later."],
                        ["55–74",  "Moderate opportunity. Decent setup but not fully extended. COS at this level while INS is higher is the ideal pre-breakout configuration."],
                        ["35–54",  "Low opportunity. Wait for COS to improve before committing."],
                        ["0–34",   "Avoid. Weak fundamentals and/or no price momentum — no edge here."],
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
                const rdIns      = resolveDelta(delta, "ins");
                const rdAcs      = resolveDelta(delta, "acs");
                const rdCos      = resolveDelta(delta, "cos");
                const csosChips  = resolveCsosChips(delta);
                const cpe        = score.cpe ?? 50;
                const rdCpe      = resolveDelta(delta, "cpe");
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
                    <td className="px-3 py-2.5 text-center hidden sm:table-cell">
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
                        <AnalysisTooltip row={row} />
                        {row.onDemand && (
                          <span className="text-[8px] font-bold px-1 py-px rounded border bg-amber-500/10 text-amber-300 border-amber-500/40 leading-none">
                            ON-DEMAND
                          </span>
                        )}
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

                    {/* BPS + LQS — hero column */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {/* BPS + LQS scores side-by-side */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] uppercase text-zinc-600 font-bold tracking-wide leading-none mb-0.5">BPS</span>
                            <span className={cn("font-black text-xl tabular-nums leading-none", bpsColor(score.bps ?? 0))}>
                              {score.bps ?? "—"}
                            </span>
                          </div>
                          <span className="text-zinc-700 text-sm">·</span>
                          <div className="flex flex-col items-center">
                            <span className="text-[8px] uppercase text-zinc-600 font-bold tracking-wide leading-none mb-0.5">LQS</span>
                            <span className={cn("font-black text-xl tabular-nums leading-none", lqsColor(score.lqs ?? 0))}>
                              {score.lqs ?? "—"}
                            </span>
                          </div>
                        </div>
                        {/* Label + VQS/GVS subline + CSOS chips */}
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className={cn("text-[9px] font-bold uppercase tracking-wide leading-none", csosLabelStyle(label))}>
                            {label}
                          </span>
                          <span className="hidden sm:inline text-[9px] text-zinc-600 leading-none tabular-nums">
                            VQS {score.vqs} · GVS {score.gvs}
                          </span>
                          {csosChips.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {csosChips.map(({ v, label: lbl }) => (
                                <DeltaChip key={lbl} v={v} label={lbl} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* CPE + trend arrow + best delta */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={cn("font-bold text-sm tabular-nums", cpeColor(cpe))}>{cpe}</span>
                          <TrendArrow trend={delta?.trends?.cpe} />
                        </div>
                        <DeltaChip v={rdCpe.v} label={rdCpe.label} />
                      </div>
                    </td>

                    {/* INS + trend arrow + best delta */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={cn("font-bold text-sm tabular-nums", insColor(ins))}>{ins}</span>
                          <TrendArrow trend={delta?.trends?.ins} />
                        </div>
                        <DeltaChip v={rdIns.v} label={rdIns.label} />
                      </div>
                    </td>

                    {/* ACS + trend arrow + best delta */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={cn("font-bold text-sm tabular-nums", acsColor(acs))}>{acs}</span>
                          <TrendArrow trend={delta?.trends?.acs} />
                        </div>
                        <DeltaChip v={rdAcs.v} label={rdAcs.label} />
                      </div>
                    </td>

                    {/* COS + best delta */}
                    <td className="px-3 py-2.5 text-center hidden lg:table-cell">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className={cn("font-bold text-sm tabular-nums", scoreColor(cos))}>{cos}</span>
                        <DeltaChip v={rdCos.v} label={rdCos.label} />
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
