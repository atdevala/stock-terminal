import type { Quote, StockInfo, StockScore, SignalDelta } from "@workspace/api-client-react";
import { PriceCell } from "./PriceCell";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StockRowProps {
  stock: StockInfo;
  quote?: Quote;
  score?: StockScore;
  signalDelta?: SignalDelta;
}

function scoreColor(s: number): string {
  if (s >= 75) return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  if (s >= 55) return "text-yellow-400 border-yellow-500/40 bg-yellow-500/10";
  if (s >= 35) return "text-orange-400 border-orange-500/40 bg-orange-500/10";
  return "text-red-400 border-red-500/40 bg-red-500/10";
}

function insColor(s: number): string {
  if (s >= 75) return "text-violet-300 border-violet-500/50 bg-violet-500/10";
  if (s >= 55) return "text-violet-400 border-violet-600/40 bg-violet-600/10";
  if (s >= 35) return "text-violet-500/80 border-violet-700/40 bg-violet-700/10";
  return "text-zinc-500 border-zinc-700/40 bg-zinc-800/30";
}

function acsColor(s: number): string {
  if (s >= 75) return "text-teal-300 border-teal-500/50 bg-teal-500/10";
  if (s >= 55) return "text-teal-400 border-teal-600/40 bg-teal-600/10";
  if (s >= 35) return "text-teal-500/80 border-teal-700/40 bg-teal-700/10";
  return "text-zinc-500 border-zinc-700/40 bg-zinc-800/30";
}

function csosColor(s: number): string {
  if (s >= 75) return "text-amber-300 border-amber-500/50 bg-amber-500/10";
  if (s >= 55) return "text-amber-400 border-amber-600/40 bg-amber-600/10";
  if (s >= 35) return "text-orange-400 border-orange-500/40 bg-orange-500/10";
  return "text-zinc-500 border-zinc-700/40 bg-zinc-800/30";
}

// Text-only color helpers for the mobile score strip (no bg/border side-effects)
function scoreTextColor(s: number): string {
  if (s >= 75) return "text-emerald-400";
  if (s >= 55) return "text-yellow-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}
function insTextColor(s: number): string {
  if (s >= 75) return "text-violet-300";
  if (s >= 55) return "text-violet-400";
  if (s >= 35) return "text-violet-500";
  return "text-zinc-500";
}
function acsTextColor(s: number): string {
  if (s >= 75) return "text-teal-300";
  if (s >= 55) return "text-teal-400";
  if (s >= 35) return "text-teal-500";
  return "text-zinc-500";
}
function csosTextColor(s: number): string {
  if (s >= 75) return "text-amber-300";
  if (s >= 55) return "text-amber-400";
  if (s >= 35) return "text-orange-400";
  return "text-zinc-500";
}

function divergenceStyle(tag: string): string {
  if (tag === "EARLY OPPORTUNITY")  return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
  if (tag === "LATE STAGE RISK")    return "bg-red-500/15 text-red-300 border-red-500/30";
  if (tag === "HIGH CONVICTION")    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return "";
}

function tierStyle(tier: number): string {
  if (tier === 3) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (tier === 2) return "bg-blue-500/15 text-blue-300 border-blue-500/30";
  if (tier === 1) return "bg-zinc-700/40 text-zinc-400 border-zinc-600/30";
  return "";
}

function tierLabel(tier: number): string {
  if (tier === 3) return "T3";
  if (tier === 2) return "T2";
  if (tier === 1) return "T1";
  return "";
}

function fmt(v: number | undefined, suffix = "%", decimals = 1): string {
  if (v === undefined || v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}${suffix}`;
}

// ── Delta helpers ──────────────────────────────────────────────────────────────

type SignalKey = "vqs" | "gvs" | "cos" | "ins" | "acs";

function formatBaselineAge(ms: number): string {
  if (ms >= 23 * 3600_000) return "1D";
  if (ms >= 3600_000) return `${Math.round(ms / 3600_000)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

interface DeltaChip { delta: number; period: string }

/**
 * Returns up to 3 chips for a score key:
 *   1. Short-term: delta1H (label "1H") or deltaBaseline (label "2h" / "30m" etc.)
 *   2. Medium:     delta1D  (label "1D")
 *   3. Long:       delta7D  (label "7D")
 * Zero-delta chips are omitted — no point showing ±0.
 */
function getDeltaChips(sd: SignalDelta | undefined, key: SignalKey): DeltaChip[] {
  if (!sd) return [];
  const chips: DeltaChip[] = [];

  // Short-term slot: prefer explicit 1H bucket, fall back to baseline
  const v1H = sd.delta1H?.[key];
  if (v1H !== undefined && v1H !== null && v1H !== 0) {
    chips.push({ delta: v1H, period: "1H" });
  } else {
    const vB = sd.deltaBaseline?.[key];
    if (vB !== undefined && vB !== null && vB !== 0 && sd.baselineAgeMs != null) {
      chips.push({ delta: vB, period: formatBaselineAge(sd.baselineAgeMs) });
    }
  }

  // Medium-term slot
  const v1D = sd.delta1D?.[key];
  if (v1D !== undefined && v1D !== null && v1D !== 0) {
    chips.push({ delta: v1D, period: "1D" });
  }

  // Long-term slot
  const v7D = sd.delta7D?.[key];
  if (v7D !== undefined && v7D !== null && v7D !== 0) {
    chips.push({ delta: v7D, period: "7D" });
  }

  return chips;
}

// ── Delta chips inside badge ───────────────────────────────────────────────────

function DeltaChips({ chips }: { chips: DeltaChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-[1px] mt-0.5">
      {chips.map(({ delta, period }) => {
        const pos = delta > 0;
        return (
          <span
            key={period}
            className={cn(
              "text-[9px] leading-none font-semibold tabular-nums",
              pos ? "text-emerald-400" : "text-red-400"
            )}
          >
            {pos ? "+" : ""}{delta}
            <span className="opacity-60 font-normal"> {period}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── Score badge ────────────────────────────────────────────────────────────────

function ScoreBadge({
  label,
  score,
  colorFn,
  chips,
  tooltip,
}: {
  label: string;
  score: number;
  colorFn?: (s: number) => string;
  chips: DeltaChip[];
  tooltip: React.ReactNode;
}) {
  const color = (colorFn ?? scoreColor)(score);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "inline-flex flex-col items-center cursor-help rounded border px-1.5 py-0.5 w-14 select-none",
            color
          )}
          data-testid={`score-badge-${label}`}
        >
          <span className="font-bold text-sm leading-tight">{score}</span>
          <DeltaChips chips={chips} />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        className="max-w-[290px] p-0 overflow-hidden !bg-black border border-zinc-700 shadow-2xl rounded-lg"
        style={{ backgroundColor: "#000000" }}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Tooltip contents ───────────────────────────────────────────────────────────

function ScoreTooltipContent({ score }: { score: StockScore }) {
  const rows: [string, string][] = [
    ["Rev Growth YoY", fmt(score.revenueGrowthYoy)],
    ["Rev Growth QoQ", fmt(score.revenueGrowthQoQ)],
    ["Gross Margin",   fmt(score.grossMargin)],
    ["Op Margin",      fmt(score.operatingMargin)],
    ["FCF Margin",     fmt(score.fcfMargin)],
    ["Debt / Equity",  score.debtToEquity !== undefined ? score.debtToEquity.toFixed(2) : "—"],
    ["P/E (TTM)",      score.pe !== undefined ? score.pe.toFixed(1) : "—"],
    ["EV / Sales",     score.evSales !== undefined ? score.evSales.toFixed(1) + "×" : "—"],
    ["Price > 50-day MA",  score.priceAbove50MA !== undefined ? (score.priceAbove50MA ? "✓ Yes" : "✗ No") : "—"],
    ["Price > 200-day MA", score.priceAbove200MA !== undefined ? (score.priceAbove200MA ? "✓ Yes" : "✗ No") : "—"],
    ["Analyst Trend",  score.earningsRevisionsUp !== undefined ? (score.earningsRevisionsUp ? "↑ Bullish" : "↓ Bearish") : "—"],
  ];

  return (
    <div className="text-xs" style={{ backgroundColor: "#000000", color: "#ffffff" }}>
      <div className="grid grid-cols-3 border-b px-3 py-2.5" style={{ borderColor: "#27272a", backgroundColor: "#111111" }}>
        {[
          { label: "VQS", score: score.vqs, sublabel: score.vqsLabel },
          { label: "GVS", score: score.gvs, sublabel: score.gvsLabel },
          { label: "COS", score: score.cos, sublabel: score.cosLabel },
        ].map((col, i) => (
          <div key={col.label} className={cn("text-center px-2", i === 1 && "border-x")} style={{ borderColor: "#27272a" }}>
            <div className="uppercase tracking-widest text-[9px] mb-0.5" style={{ color: "#71717a" }}>{col.label}</div>
            <div className={cn("text-lg font-bold leading-none mb-1", scoreColor(col.score).split(" ")[0])}>{col.score}</div>
            <div className="text-[9px] leading-tight" style={{ color: "#a1a1aa" }}>{col.sublabel}</div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between items-center gap-6">
            <span style={{ color: "#71717a" }}>{k}</span>
            <span className="font-mono font-medium" style={{ color: v === "—" ? "#52525b" : "#ffffff" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsTooltipContent({ score }: { score: StockScore }) {
  const ins = score.ins ?? 0;
  const c = score.insComponents;

  const subRows: [string, number | undefined, string][] = [
    ["Delta GVS",          c?.deltaGvs,          "25%"],
    ["Volume Accel",       c?.volumeAccel,        "20%"],
    ["Narrative Momentum", c?.narrativeMomentum,  "20%"],
    ["EPS Slope",          c?.epsSlope,           "20%"],
    ["Delta VQS",          c?.deltaVqs,           "15%"],
  ];

  const divTag = score.divergenceTag;

  return (
    <div className="text-xs" style={{ backgroundColor: "#000000", color: "#ffffff" }}>
      <div className="px-3 py-2.5 border-b" style={{ borderColor: "#27272a", backgroundColor: "#0d0d14" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="uppercase tracking-widest text-[9px]" style={{ color: "#7c6fcd" }}>INS — Inflection Signal</span>
          <span className={cn("text-lg font-bold leading-none", insColor(ins).split(" ")[0])}>{ins}</span>
        </div>
        <div className="text-[9px] leading-tight" style={{ color: "#a1a1aa" }}>{score.insLabel}</div>
        {divTag && (
          <div className={cn("mt-2 text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border inline-block", divergenceStyle(divTag))}>
            {divTag}
          </div>
        )}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "#52525b" }}>Score Breakdown</div>
        {subRows.map(([k, v, w]) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <span style={{ color: "#52525b" }} className="font-mono text-[9px]">{w}</span>
              <span style={{ color: "#71717a" }}>{k}</span>
            </div>
            <span className="font-mono font-medium" style={{ color: v !== undefined ? "#ffffff" : "#52525b" }}>
              {v !== undefined ? v : "—"}
            </span>
          </div>
        ))}
      </div>
      <div className="px-3 pb-2 text-[9px] italic" style={{ color: "#52525b" }}>
        INS leads COS by 2–6 weeks in early breakouts.
      </div>
    </div>
  );
}

function AcsTooltipContent({ score }: { score: StockScore }) {
  const acs = score.acs ?? 50;
  const label = acs >= 80 ? "Strong Institutional Accumulation"
              : acs >= 60 ? "Moderate Accumulation"
              : "Weak / No Accumulation";

  return (
    <div className="text-xs" style={{ backgroundColor: "#000000", color: "#ffffff" }}>
      <div className="px-3 py-2.5 border-b" style={{ borderColor: "#27272a", backgroundColor: "#0d1414" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="uppercase tracking-widest text-[9px]" style={{ color: "#2dd4bf" }}>ACS — Accumulation Confidence</span>
          <span className={cn("text-lg font-bold leading-none", acsColor(acs).split(" ")[0])}>{acs}</span>
        </div>
        <div className="text-[9px] leading-tight" style={{ color: "#a1a1aa" }}>{label}</div>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: "#52525b" }}>Formula Components</div>
        {[
          ["30%", "Up-Volume Strength",  "% of total vol on up-days"],
          ["25%", "Relative Strength",   "Excess return vs SPY (20D)"],
          ["20%", "Price Compression",   "Recent vol < historical vol"],
          ["15%", "Breakout Volume",     "5D avg vol vs 20D avg vol"],
          ["10%", "Closing Strength",    "Price above 10-day SMA"],
        ].map(([w, k, desc]) => (
          <div key={k} className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[9px] mt-0.5 shrink-0" style={{ color: "#52525b" }}>{w}</span>
              <div>
                <div style={{ color: "#71717a" }}>{k}</div>
                <div className="text-[9px]" style={{ color: "#52525b" }}>{desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 pb-2 text-[9px] italic" style={{ color: "#52525b" }}>
        ACS detects quiet institutional buying before the crowd notices.
      </div>
    </div>
  );
}

function cpeColor(s: number): string {
  if (s >= 75) return "text-sky-300 border-sky-500/50 bg-sky-500/10";
  if (s >= 55) return "text-sky-400 border-sky-600/40 bg-sky-600/10";
  if (s >= 35) return "text-sky-500/80 border-sky-700/40 bg-sky-700/10";
  return "text-zinc-500 border-zinc-700/40 bg-zinc-800/30";
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

// ── CSOS tooltip helpers ───────────────────────────────────────────────────────

function getCsosMainReason(
  label: string,
  vqs: number, ins: number, acs: number, cos: number, cpe: number,
): { headline: string; detail: string } {
  const gap = ins - cos;
  if (label === "PRIME OPPORTUNITY")
    return {
      headline: "All 5 signals are strongly aligned",
      detail: `INS (${ins}), ACS (${acs}), COS (${cos}), and VQS (${vqs}) are all elevated together — rare full-conviction setup where fundamentals, growth, momentum, and institutional accumulation are firing in unison.`,
    };
  if (label === "EARLY BREAKOUT SETUP")
    return {
      headline: `INS is leading COS by ${gap} points`,
      detail: `INS (${ins}) is signaling early institutional positioning before the move shows up in COS (${cos}). This gap historically closes over 2–6 weeks as the broader market confirms the move.`,
    };
  if (label === "STEALTH ACCUMULATION")
    return {
      headline: `Quiet institutional build-up detected (ACS ${acs})`,
      detail: `ACS (${acs}) is elevated with COS (${cos}) still low and CPE (${cpe}) confirming catalyst probability — institutions are quietly positioning before the public breakout. Classic pre-announcement accumulation pattern.`,
    };
  if (label === "HIDDEN CATALYST POTENTIAL")
    return {
      headline: `Market underpricing an upcoming catalyst (CPE ${cpe})`,
      detail: `CPE (${cpe}) is high while COS (${cos}) is still muted — the market hasn't yet priced in the improving underlying story. Quality and accumulation signals suggest a re-rating event may be approaching.`,
    };
  if (label === "QUALITY COMPOUNDER — ACTIVATING")
    return {
      headline: `Fundamentals-anchored with INS now live (VQS ${vqs}, INS ${ins})`,
      detail: `VQS carries 40% weight and is the dominant driver here. INS (${ins}) has crossed 60 — the timing signal is now active alongside strong fundamentals. This is an established quality business entering an active setup phase.`,
    };
  if (label === "QUALITY COMPOUNDER — DORMANT")
    return {
      headline: `Fundamentals-anchored, timing signal not yet live (VQS ${vqs})`,
      detail: `VQS carries 40% weight and is the dominant driver here. INS (${ins}) has not yet crossed 60 — the business quality is strong but there is no timing signal to act on. Watch for INS to activate before committing capital.`,
    };
  if (label === "CONFIRMED TREND")
    return {
      headline: `Momentum confirmed across INS (${ins}) and COS (${cos})`,
      detail: `Both the leading signal and the confirmation signal are elevated with ACS (${acs}) providing institutional support. The trend has backing and is not yet extended.`,
    };
  if (label === "LATE STAGE MOVE")
    return {
      headline: `COS (${cos}) is extended while INS (${ins}) is fading`,
      detail: `The breakout signal (INS) is weakening while the confirmation signal (COS) is fully extended. This pattern suggests the bulk of the move has already occurred — risk/reward is deteriorating for new entries.`,
    };
  if (label === "DEVELOPING SETUP")
    return {
      headline: "Mixed signals — no dominant pattern yet",
      detail: `Signals are building but haven't converged into a clear pattern. Watch INS and ACS for strengthening — a rise in INS with COS still lagging would upgrade this to Early Breakout.`,
    };
  return {
    headline: `Fundamental floor override (VQS ${vqs})`,
    detail: `VQS below 40 triggers a structural penalty that overrides positive momentum signals. CSOS hard-penalizes weak businesses regardless of price action — fundamentals must recover before the score can.`,
  };
}

function getCsosEdgeInsights(
  vqs: number, ins: number, acs: number, cos: number, fbrs?: number,
): string[] {
  const insights: string[] = [];
  const gap = ins - cos;

  if (gap > 20 && ins > 55)
    insights.push(`INS leads COS by ${gap} pts — potential 2–6 week window before broad-market confirmation. Highest-edge entry zone.`);

  if (acs > ins + 15 && acs > 60)
    insights.push(`ACS (${acs}) is ahead of INS (${ins}) — quiet institutional accumulation before price momentum forms. Stealth-entry pattern.`);

  if (ins >= 65 && acs >= 65 && Math.abs(ins - acs) < 15)
    insights.push(`INS and ACS are co-elevated (${ins}/${acs}) — momentum and accumulation confirming each other simultaneously. Highest-quality signal combination.`);

  if (vqs >= 70 && ins >= 60)
    insights.push(`VQS ${vqs} + INS ${ins} — quality-growth alignment is rare and tends to compound. These are the setups that produce multi-year winners.`);

  if (vqs < 45 && ins > 65)
    insights.push(`⚠ Weak fundamentals (VQS ${vqs}) with strong momentum (INS ${ins}) — vulnerable to sharp reversal if sentiment shifts. Reduce position size.`);

  if (cos > 70 && ins > 65)
    insights.push(`COS (${cos}) confirmed with INS (${ins}) still elevated — trend has institutional conviction, not just price extension.`);

  if (fbrs !== undefined && fbrs > 65)
    insights.push(`⚠ FBRS ${fbrs} — elevated false-breakout risk. Verify volume is organic before sizing up.`);

  if (cos > 80 && ins < 50)
    insights.push(`COS (${cos}) fully extended while INS (${ins}) declining — the smart money is reducing, not adding. Late-cycle caution.`);

  return insights.slice(0, 3);
}

function CpeTooltipContent({ score }: { score: StockScore }) {
  const cpe  = score.cpe ?? 0;
  const cos  = score.cos;
  const vqs  = score.vqs;
  const gvs  = score.gvs;
  const acs  = score.acs;
  const ins  = score.ins ?? 0;
  const fbrs = score.fbrs ?? 0;

  const cpeLabel = cpe >= 80 ? "High Catalyst Probability"
                 : cpe >= 60 ? "Moderate — Setup Developing"
                 : "Story Priced In / No Edge";

  const components: [string, string, number, string][] = [
    ["25%", "Narrative Asymmetry",      Math.round((score.vqs * 0.6 + gvs * 0.4) - cos), "Quality signal vs consensus gap"],
    ["25%", "Quiet Accumulation",       acs,   "ACS elevated, COS still low"],
    ["20%", "Low Attention / Quality",  vqs,   "Strong VQS unrecognized by momentum"],
    ["20%", "False Hype Filter",        100 - fbrs, "Inverse of FBRS (clean setup)"],
    ["10%", "Strategic Positioning",    ins,   "INS + ACS leading COS"],
  ];

  return (
    <div className="text-xs" style={{ backgroundColor: "#000000", color: "#ffffff", minWidth: "270px" }}>
      <div className="px-3 py-2.5 border-b" style={{ borderColor: "#27272a", backgroundColor: "#000d14" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="uppercase tracking-widest text-[9px]" style={{ color: "#38bdf8" }}>CPE — Catalyst Probability</span>
          <span className={cn("text-xl font-bold leading-none", cpeColor(cpe).split(" ")[0])}>{cpe}</span>
        </div>
        <div className={cn("text-[10px] font-semibold uppercase tracking-wide", cpeColor(cpe).split(" ")[0])}>{cpeLabel}</div>
      </div>
      <div className="px-3 py-2.5 border-b" style={{ borderColor: "#1c1c1c" }}>
        <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#52525b" }}>What CPE Detects</div>
        <div className="text-[10px] leading-relaxed" style={{ color: "#a1a1aa" }}>
          Estimates the probability the market is <span style={{ color: "#e4e4e7" }}>underpricing a future major catalyst</span> —
          enterprise contracts, institutional re-ratings, strategic partnerships, or surprise guidance shifts.
          High CPE + low COS = the market hasn't confirmed it yet.
        </div>
      </div>
      <div className="px-3 pt-2 pb-2">
        <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#52525b" }}>Proxy Components</div>
        <div className="space-y-1">
          {components.map(([wt, k, val, desc]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="font-mono text-[9px] shrink-0" style={{ color: "#3f3f46" }}>{wt}</span>
                <div className="min-w-0">
                  <div style={{ color: "#71717a" }}>{k}</div>
                  <div className="text-[9px]" style={{ color: "#3f3f46" }}>{desc}</div>
                </div>
              </div>
              <span className="font-mono font-semibold text-[10px] shrink-0" style={{ color: "#e4e4e7" }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="px-3 pb-2 text-[9px] italic" style={{ color: "#52525b" }}>
        Percentile-ranked within the 103-stock watchlist universe.
      </div>
    </div>
  );
}

function CsosTooltipContent({ score }: { score: StockScore }) {
  const csos  = score.csos ?? 0;
  const label = score.csosLabel ?? "—";
  const ins   = score.ins ?? 0;
  const acs   = score.acs;
  const cos   = score.cos;
  const vqs   = score.vqs;
  const gvs   = score.gvs;
  const cpe   = score.cpe ?? 0;

  const reason   = getCsosMainReason(label, vqs, ins, acs, cos, cpe);
  const insights = getCsosEdgeInsights(vqs, ins, acs, cos, score.fbrs);

  const components: [string, number, string][] = [
    ["VQS", vqs,  "40%"],
    ["GVS", gvs,  "25%"],
    ["INS", ins,  "15%"],
    ["ACS", acs,  "12%"],
    ["COS", cos,   "8%"],
    ["CPE", cpe,  "+bonus"],
  ];
  const base = Math.round(vqs * 0.40 + gvs * 0.25 + ins * 0.15 + acs * 0.12 + cos * 0.08);

  const layers: { text: string; color: string }[] = [];
  if (ins > 75 && cos < 60)                          layers.push({ text: "Early Breakout Edge (+bonus)",     color: "text-amber-300" });
  if (cos > 80 && ins < 50)                          layers.push({ text: "Late Stage Warning (−penalty)",    color: "text-red-400"   });
  if (vqs < 40)                                       layers.push({ text: "Fundamental Floor (−override)",    color: "text-red-400"   });
  if (ins >= 65 && acs >= 65)                        layers.push({ text: "Accumulation Boost (×multiplier)", color: "text-teal-400"  });
  if (ins > 72 && acs < 45)                         layers.push({ text: "Divergence Penalty: INS∅ACS",      color: "text-orange-400"});
  if (cos > 72 && ins < 45)                         layers.push({ text: "Divergence Penalty: COS∅INS",      color: "text-orange-400"});
  if (acs > 68 && vqs < 38)                        layers.push({ text: "Divergence Penalty: ACS∅VQS",      color: "text-orange-400"});
  if (ins > 70 && acs > 70 && cos > 70 && vqs > 60) layers.push({ text: "Signal Agreement Bonus (+bonus)",  color: "text-emerald-400"});

  return (
    <div className="text-xs" style={{ backgroundColor: "#000000", color: "#ffffff", minWidth: "280px" }}>

      {/* ── Header: score + label ── */}
      <div className="px-3 py-2.5 border-b" style={{ borderColor: "#27272a", backgroundColor: "#0d0a00" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="uppercase tracking-widest text-[9px]" style={{ color: "#d97706" }}>CSOS — Composite Score</span>
          <span className={cn("text-xl font-bold leading-none", csosColor(csos).split(" ")[0])}>{csos}</span>
        </div>
        <div className={cn("text-[10px] font-bold uppercase tracking-wider", csosLabelStyle(label))}>{label}</div>
      </div>

      {/* ── Main reason ── */}
      <div className="px-3 pt-2.5 pb-2 border-b" style={{ borderColor: "#1c1c1c" }}>
        <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#52525b" }}>Primary Driver</div>
        <div className="font-semibold text-[11px] leading-snug mb-1" style={{ color: "#e4e4e7" }}>{reason.headline}</div>
        <div className="text-[10px] leading-relaxed" style={{ color: "#71717a" }}>{reason.detail}</div>
      </div>

      {/* ── Analytical edge ── */}
      {insights.length > 0 && (
        <div className="px-3 pt-2 pb-2 border-b" style={{ borderColor: "#1c1c1c" }}>
          <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#52525b" }}>Analytical Edge</div>
          <div className="space-y-1.5">
            {insights.map((ins, idx) => (
              <div key={idx} className="flex gap-1.5">
                <span style={{ color: "#d97706" }} className="mt-0.5 shrink-0">›</span>
                <span className="text-[10px] leading-snug" style={{ color: ins.startsWith("⚠") ? "#f87171" : "#a1a1aa" }}>{ins}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Signal weight breakdown ── */}
      <div className="px-3 pt-2 pb-2 border-b" style={{ borderColor: "#1c1c1c" }}>
        <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#52525b" }}>Signal Weights</div>
        <div className="space-y-1">
          {components.map(([k, val, wt]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 w-16">
                <span className="font-mono text-[9px]" style={{ color: "#3f3f46" }}>{wt}</span>
                <span className="text-[10px]" style={{ color: "#71717a" }}>{k}</span>
              </div>
              <div className="flex items-center gap-1.5 flex-1">
                <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: "#1c1c1e" }}>
                  <div className="h-full rounded-full" style={{ width: `${val}%`, backgroundColor: val >= 70 ? "#d97706" : val >= 50 ? "#a16207" : "#6b5d37" }} />
                </div>
                <span className="font-mono font-semibold text-[10px] w-5 text-right" style={{ color: "#e4e4e7" }}>{val}</span>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 border-t mt-1" style={{ borderColor: "#27272a" }}>
            <span className="text-[9px]" style={{ color: "#3f3f46" }}>Unweighted base</span>
            <span className="font-mono text-[9px]" style={{ color: "#52525b" }}>{base}</span>
          </div>
        </div>
      </div>

      {/* ── Active intelligence layers ── */}
      {layers.length > 0 && (
        <div className="px-3 pt-2 pb-2">
          <div className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: "#52525b" }}>Active Adjustments</div>
          <div className="space-y-1">
            {layers.map(l => (
              <div key={l.text} className={cn("text-[9px] font-medium", l.color)}>{l.text}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────────

export function StockRow({ stock, quote, score, signalDelta }: StockRowProps) {
  if (!quote) {
    return (
      <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors">
        <td className="py-2.5 px-4">
          <div className="font-bold text-sm">{stock.ticker}</div>
          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{stock.company}</div>
        </td>
        <td colSpan={12} className="py-2.5 px-4 text-center text-muted-foreground text-sm">
          Loading...
        </td>
      </tr>
    );
  }

  const isUp = quote.change >= 0;
  const changeColor = isUp ? "text-green-500" : "text-red-500";

  const extChangePct = quote.open > 0 ? ((quote.price - quote.open) / quote.open) * 100 : 0;
  const extIsUp = extChangePct >= 0;
  const extColor = extIsUp ? "text-green-500" : "text-red-500";

  const divTag = score?.divergenceTag;
  const hasDivTag = divTag && divTag.length > 0;
  const fbrs = score?.fbrs ?? 0;
  const showFbrsCaution = fbrs > 70;
  const isSuperstock = score?.isSuperstock ?? false;
  const tier = score?.convictionTier ?? 0;

  return (
    <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors group" data-testid={`stock-row-${stock.ticker}`}>
      <td className="py-2.5 px-4 align-top">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-sm" data-testid={`stock-ticker-${stock.ticker}`}>{stock.ticker}</span>
          {isSuperstock && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[11px] cursor-help select-none" title="Superstock Candidate">⭐</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs" style={{ backgroundColor: "#000000", border: "1px solid #44403c" }}>
                <div style={{ color: "#fcd34d" }} className="font-semibold mb-0.5">SUPERSTOCK CANDIDATE</div>
                <div style={{ color: "#a1a1aa" }} className="text-[10px]">INS ≥ 72 · ACS ≥ 68 · FBRS &lt; 28</div>
                <div style={{ color: "#71717a" }} className="text-[10px] mt-0.5">Early NVDA / CRDO-type setup</div>
              </TooltipContent>
            </Tooltip>
          )}
          {tier > 0 && (
            <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded border leading-none", tierStyle(tier))}>
              {tierLabel(tier)}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={stock.company}>{stock.company}</div>
        {hasDivTag && (
          <div className={cn("mt-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border inline-block", divergenceStyle(divTag))}>
            {divTag}
          </div>
        )}
        {showFbrsCaution && (
          <div className="mt-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border inline-block bg-red-500/10 text-red-300 border-red-500/30">
            ⚠ CAUTION: HYPE-DRIVEN MOVE
          </div>
        )}
        {/* Mobile score strip — shown below xl where full score columns are hidden.
            Each label+value pair is a non-wrapping unit so they never orphan. */}
        {score && (() => {
          const insD1 = getDeltaChips(signalDelta, "ins").find(c => c.period === "1D")?.delta ?? 0;
          return (
            <div className="xl:hidden flex items-center gap-2 mt-1.5 flex-wrap">
              <div className="flex items-center gap-1 flex-nowrap">
                <span className="text-[9px] text-zinc-600 font-medium">COS</span>
                <span className={cn("text-[10px] font-bold tabular-nums", scoreTextColor(score.cos))}>{score.cos}</span>
              </div>
              <span className="text-zinc-700 text-[9px]">·</span>
              <div className="flex items-center gap-1 flex-nowrap">
                <span className="text-[9px] text-zinc-600 font-medium">INS</span>
                <span className={cn("text-[10px] font-bold tabular-nums", insTextColor(score.ins ?? 0))}>{score.ins ?? "—"}</span>
                {insD1 !== 0 && (
                  <span className={cn("text-[8px] font-semibold tabular-nums", insD1 > 0 ? "text-emerald-400" : "text-red-400")}>
                    {insD1 > 0 ? "+" : ""}{insD1}
                  </span>
                )}
              </div>
              <span className="text-zinc-700 text-[9px]">·</span>
              <div className="flex items-center gap-1 flex-nowrap">
                <span className="text-[9px] text-zinc-600 font-medium">ACS</span>
                <span className={cn("text-[10px] font-bold tabular-nums", acsTextColor(score.acs))}>{score.acs}</span>
              </div>
              <span className="text-zinc-700 text-[9px]">·</span>
              <div className="flex items-center gap-1 flex-nowrap">
                <span className="text-[9px] text-zinc-600 font-medium">CSOS</span>
                <span className={cn("text-[10px] font-bold tabular-nums", csosTextColor(score.csos ?? 0))}>{score.csos ?? "—"}</span>
              </div>
            </div>
          );
        })()}
      </td>
      <td className="py-2.5 px-4 text-right align-top">
        <PriceCell
          price={quote.price}
          lastUpdated={quote.lastUpdated}
          prefix="$"
          testId={`stock-price-${stock.ticker}`}
          className="font-bold text-[15px]"
        />
      </td>
      <td className="py-2.5 px-4 text-right align-top">
        <div className={cn("font-mono text-sm", changeColor)} data-testid={`stock-change-dollar-${stock.ticker}`}>
          {isUp ? "+" : ""}{formatCurrency(quote.change)}
        </div>
      </td>
      <td className="py-2.5 px-4 text-right align-top">
        <div className={cn("font-mono text-sm", changeColor)} data-testid={`stock-change-${stock.ticker}`}>
          {formatPercent(quote.changePercent)}
        </div>
      </td>
      <td className="py-2.5 px-4 text-right align-top">
        <div className={cn("font-mono text-sm", extColor)} data-testid={`stock-change-percent-${stock.ticker}`}>
          {quote.open > 0 ? formatPercent(extChangePct) : "—"}
        </div>
      </td>
      <td className="py-2.5 px-4 text-right text-muted-foreground font-mono text-xs align-top">
        <div>{formatCurrency(quote.high)}</div>
        <div>{formatCurrency(quote.low)}</div>
      </td>
      <td className="py-2.5 px-4 text-right text-muted-foreground font-mono text-xs align-top hidden md:table-cell">
        <div>{quote.high52 ? formatCurrency(quote.high52) : "—"}</div>
        <div>{quote.low52 ? formatCurrency(quote.low52) : "—"}</div>
      </td>
      <td className="py-2.5 px-4 text-right text-muted-foreground font-mono text-sm align-top hidden sm:table-cell">
        {quote.pe ? quote.pe.toFixed(2) : "—"}
      </td>

      {/* VQS */}
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score ? (
          <ScoreBadge
            label={`vqs-${stock.ticker}`}
            score={score.vqs}
            chips={getDeltaChips(signalDelta, "vqs")}
            tooltip={<ScoreTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      {/* GVS */}
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score ? (
          <ScoreBadge
            label={`gvs-${stock.ticker}`}
            score={score.gvs}
            chips={getDeltaChips(signalDelta, "gvs")}
            tooltip={<ScoreTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      {/* COS */}
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score ? (
          <ScoreBadge
            label={`cos-${stock.ticker}`}
            score={score.cos}
            chips={getDeltaChips(signalDelta, "cos")}
            tooltip={<ScoreTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      {/* INS */}
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score?.ins !== undefined ? (
          <ScoreBadge
            label={`ins-${stock.ticker}`}
            score={score.ins}
            colorFn={insColor}
            chips={getDeltaChips(signalDelta, "ins")}
            tooltip={<InsTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      {/* ACS */}
      <td className="py-2.5 px-3 text-center align-middle hidden 2xl:table-cell">
        {score ? (
          <ScoreBadge
            label={`acs-${stock.ticker}`}
            score={score.acs}
            colorFn={acsColor}
            chips={getDeltaChips(signalDelta, "acs")}
            tooltip={<AcsTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      {/* CPE */}
      <td className="py-2.5 px-3 text-center align-middle hidden 2xl:table-cell">
        {score?.cpe !== undefined ? (
          <ScoreBadge
            label={`cpe-${stock.ticker}`}
            score={score.cpe}
            colorFn={cpeColor}
            chips={[]}
            tooltip={<CpeTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      {/* CSOS */}
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score?.csos !== undefined ? (
          <ScoreBadge
            label={`csos-${stock.ticker}`}
            score={score.csos}
            colorFn={csosColor}
            chips={[]}
            tooltip={<CsosTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      <td className="py-2.5 px-4 text-center text-muted-foreground text-xs align-top hidden lg:table-cell">
        <div>{stock.focus}</div>
      </td>
    </tr>
  );
}
