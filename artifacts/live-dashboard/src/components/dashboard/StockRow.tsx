import { useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import type { Quote, StockInfo, StockScore, SignalDelta } from "@workspace/api-client-react";
import { PriceCell } from "./PriceCell";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface StockRowProps {
  stock: StockInfo;
  quote?: Quote;
  score?: StockScore;
  signalDelta?: SignalDelta;
  isSelected?: boolean;
  onSelect?: (ticker: string) => void;
  /** Optional — used by the flat ranked "whole market" scanner view. */
  rank?: number;
  sectorColor?: string;
  onDemand?: boolean;
}

// ── Color helpers ────────────────────────────────────────────────────────────

function signalColor(s: number): string {
  if (s >= 75) return "text-amber-300 border-amber-500/50 bg-amber-500/10";
  if (s >= 55) return "text-amber-400 border-amber-600/40 bg-amber-600/10";
  if (s >= 35) return "text-orange-400 border-orange-500/40 bg-orange-500/10";
  return "text-zinc-500 border-zinc-700/40 bg-zinc-800/30";
}

// signalLabel can now carry a chase-risk qualifier appended by the backend
// (e.g. "CONFIRMED TREND — already extended today", see signal-consistency.ts)
// instead of replacing the whole label. Every exact-match lookup against a
// base label name below needs the qualifier stripped first, or a genuinely
// strong trend that's also extended would fall through every branch here.
const EXTENSION_SUFFIX = " — already extended today";
function stripExtensionSuffix(label: string): string {
  return label.endsWith(EXTENSION_SUFFIX) ? label.slice(0, -EXTENSION_SUFFIX.length) : label;
}

function signalLabelStyle(rawLabel: string): string {
  const label = stripExtensionSuffix(rawLabel);
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

function rsiTone(zone: StockScore["rsiZone"] | undefined): string {
  if (zone === "Oversold") return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  if (zone === "Overbought") return "text-red-400 border-red-500/40 bg-red-500/10";
  if (zone === "Neutral") return "text-zinc-400 border-zinc-700/40 bg-zinc-800/30";
  // No zone at all (rsi undefined) — visually distinct dashed/dimmed style so this
  // never reads as a real "Neutral" reading.
  return "text-zinc-700 border-dashed border-zinc-800 bg-transparent";
}

function scoreTileColor(s: number): string {
  if (s >= 75) return "text-emerald-400";
  if (s >= 55) return "text-yellow-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

function divergenceStyle(tag: string): string {
  if (tag === "EARLY OPPORTUNITY")  return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
  if (tag === "LATE STAGE RISK")    return "bg-red-500/15 text-red-300 border-red-500/30";
  if (tag === "HIGH CONVICTION")    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return "";
}

// Flags from the signal-history divergence engine (distinct source from score.divergenceTag above).
function historyDivergenceStyle(tag: string): string {
  if (tag === "EARLY IGNITION SETUP")                       return "bg-violet-500/15 text-violet-300 border-violet-500/30";
  if (tag === "INSTITUTIONAL ACCUMULATION BEFORE REPRICING") return "bg-teal-500/15 text-teal-300 border-teal-500/30";
  if (tag === "SPECULATIVE MOMENTUM (UNCONFIRMED)")          return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
  if (tag === "LATE CYCLE / EXHAUSTION RISK")                return "bg-red-500/15 text-red-300 border-red-500/30";
  return "bg-zinc-700/20 text-zinc-300 border-zinc-600/30";
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

// ── "Why" text — attached to the single retained composite (signalScore) ─────

// COS/CSOS/CPE/BPS are retired as user-visible values — this only ever
// interpolates VQS/GVS/INS/ACS/FBRS/LQS/RSI into the reason text.
function getSignalReason(
  rawLabel: string,
  vqs: number, ins: number, acs: number,
): { headline: string; detail: string } {
  const label = stripExtensionSuffix(rawLabel);
  const isExtended = label !== rawLabel;
  const { headline, detail } = getSignalReasonForBaseLabel(label, vqs, ins, acs);
  if (!isExtended) return { headline, detail };
  // Chase-risk qualifier: the base label's headline/detail still describe
  // what the trend genuinely is — this appends the timing caveat rather than
  // replacing the explanation, matching signalLabel's own "modifier, not
  // replacement" design (see signal-consistency.ts).
  return {
    headline,
    detail: `${detail} This name is also currently extended (RSI, its distance from the 50-day average, or today's move already reflect a large recent move) — the setup above is real, but chasing it here means buying after the move already happened rather than ahead of it.`,
  };
}

function getSignalReasonForBaseLabel(
  label: string,
  vqs: number, ins: number, acs: number,
): { headline: string; detail: string } {
  if (label === "PRIME OPPORTUNITY")
    return {
      headline: "All signals strongly aligned",
      detail: `INS (${ins}), ACS (${acs}), and VQS (${vqs}) are all elevated together, and price action confirms it — a rare full-conviction setup where fundamentals, growth, momentum, and institutional accumulation are firing in unison.`,
    };
  if (label === "EARLY BREAKOUT SETUP")
    return {
      headline: "Momentum is leading price confirmation",
      detail: `INS (${ins}) is signaling early institutional positioning before the broader market has confirmed the move in price. This kind of lead historically closes over 2–6 weeks.`,
    };
  if (label === "STEALTH ACCUMULATION")
    return {
      headline: `Quiet institutional build-up detected (ACS ${acs})`,
      detail: `ACS (${acs}) is elevated while price is still quiet — institutions are positioning before the public breakout.`,
    };
  if (label === "HIDDEN CATALYST POTENTIAL")
    return {
      headline: "Market underpricing an upcoming catalyst",
      detail: `Quality and accumulation signals (VQS ${vqs}, ACS ${acs}) suggest a re-rating event may be approaching, before the crowd has priced it in.`,
    };
  if (label === "QUALITY COMPOUNDER — ACTIVATING")
    return {
      headline: `Fundamentals-anchored with INS now live (VQS ${vqs}, INS ${ins})`,
      detail: `INS has crossed 60 — the timing signal is now active alongside strong fundamentals.`,
    };
  if (label === "QUALITY COMPOUNDER — DORMANT")
    return {
      headline: `Fundamentals-anchored, timing signal not yet live (VQS ${vqs})`,
      detail: `The business quality is strong but INS has not yet crossed 60 — there is no timing signal to act on.`,
    };
  if (label === "CONFIRMED TREND")
    return {
      headline: `Momentum confirmed (INS ${ins})`,
      detail: `Both the leading and confirmation signals are elevated, with ACS (${acs}) providing institutional support.`,
    };
  if (label === "LATE STAGE MOVE")
    return {
      headline: `Price is extended while INS (${ins}) is fading`,
      detail: `This pattern suggests the bulk of the move has already occurred — risk/reward is deteriorating for new entries.`,
    };
  if (label === "DEVELOPING SETUP")
    return {
      headline: "Mixed signals — no dominant pattern yet",
      detail: "Watch INS and ACS for strengthening before price catches up — that combination would upgrade this to an early breakout.",
    };
  return {
    headline: `Fundamental floor override (VQS ${vqs})`,
    detail: `VQS below 40 triggers a structural penalty that overrides positive momentum signals. Fundamentals must recover before the score can.`,
  };
}

function getSignalEdgeInsights(
  vqs: number, ins: number, acs: number, cos: number, fbrs?: number,
): string[] {
  const insights: string[] = [];
  const leadsPrice = ins - cos > 20 && ins > 55; // cos used only to decide, never displayed

  if (leadsPrice)
    insights.push("INS is running well ahead of price confirmation — potential 2–6 week window before the broader market catches up.");
  if (acs > ins + 15 && acs > 60)
    insights.push(`ACS (${acs}) is ahead of INS (${ins}) — quiet institutional accumulation before price momentum forms.`);
  if (ins >= 65 && acs >= 65 && Math.abs(ins - acs) < 15)
    insights.push(`INS and ACS are co-elevated (${ins}/${acs}) — momentum and accumulation confirming each other.`);
  if (vqs < 45 && ins > 65)
    insights.push(`⚠ Weak fundamentals (VQS ${vqs}) with strong momentum (INS ${ins}) — vulnerable to a sharp reversal.`);
  if (fbrs !== undefined && fbrs > 65)
    insights.push(`⚠ FBRS ${fbrs} — elevated false-breakout risk. Verify volume is organic before sizing up.`);
  if (cos > 80 && ins < 50)
    insights.push("Price is fully extended while INS declines — late-cycle caution.");

  return insights.slice(0, 3);
}

// ── Details panel — the "why" behind the composite score ──────────────────────
// Consolidates what used to be five separate hover tooltips (VQS/GVS/COS, INS,
// ACS, CPE, CSOS) into one expandable panel per row.

function StatTile({ label, value, sublabel }: { label: string; value: number; sublabel?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-black/30 px-2.5 py-2 text-center">
      <div className="text-[9px] uppercase tracking-widest text-zinc-600">{label}</div>
      <div className={cn("text-base font-bold leading-tight", scoreTileColor(value))}>{value}</div>
      {sublabel && <div className="text-[9px] text-zinc-500 leading-tight mt-0.5 truncate">{sublabel}</div>}
    </div>
  );
}

function DetailsPanel({ score, focus }: { score: StockScore; focus?: string }) {
  // cos is read here only to feed the reason/insight logic (which decides WHEN
  // a pattern applies) — it is never rendered. See getSignalReason's note.
  const vqs = score.vqs, gvs = score.gvs, cos = score.cos, acs = score.acs;
  const ins = score.ins ?? 0;
  const fbrs = score.fbrs;
  const lqs = score.lqs;
  const reason = getSignalReason(score.signalLabel, vqs, ins, acs);
  const insights = getSignalEdgeInsights(vqs, ins, acs, cos, fbrs);

  const fundamentals: [string, string][] = [
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
    <div className="px-4 py-3 bg-black/40 border-t border-b border-border/60 space-y-3">
      {focus && (
        <div className="text-[11px] text-zinc-400">
          <span className="text-zinc-600 uppercase tracking-widest text-[9px] mr-1.5">Focus</span>
          {focus}
        </div>
      )}
      {/* Why this label */}
      <div>
        <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Why "{score.signalLabel}"</div>
        <div className="text-xs font-semibold text-zinc-200 leading-snug">{reason.headline}</div>
        <div className="text-[11px] text-zinc-400 leading-relaxed mt-0.5">{reason.detail}</div>
        {insights.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {insights.map((tip, i) => (
              <div key={i} className="flex gap-1.5 text-[10px] text-zinc-400">
                <span className="text-amber-500/80 shrink-0">›</span>
                <span className={tip.startsWith("⚠") ? "text-red-300" : undefined}>{tip}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Underlying signals — the "why" behind the composite, not columns */}
      <div>
        <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1.5">The Numbers Behind It</div>
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-1.5">
          <StatTile label="VQS" value={vqs} sublabel="Quality" />
          <StatTile label="GVS" value={gvs} sublabel="Growth" />
          <StatTile label="INS" value={ins} sublabel="Inflection" />
          <StatTile label="ACS" value={acs} sublabel="Accum." />
          {fbrs !== undefined && <StatTile label="FBRS" value={fbrs} sublabel="Hype risk" />}
          {lqs !== undefined && <StatTile label="LQS" value={lqs} sublabel="Quality" />}
          {score.rsi !== undefined && <StatTile label="RSI" value={Math.round(score.rsi)} sublabel={score.rsiZone} />}
        </div>
      </div>

      {/* Fundamentals */}
      <div>
        <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1.5">Fundamentals</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
          {fundamentals.map(([k, v]) => (
            <div key={k} className="flex justify-between items-center gap-3 text-[11px]">
              <span className="text-zinc-500">{k}</span>
              <span className={cn("font-mono font-medium", v === "—" ? "text-zinc-600" : "text-zinc-200")}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────────

export function StockRow({
  stock, quote, score, signalDelta, isSelected = false, onSelect,
  rank, sectorColor, onDemand,
}: StockRowProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSelect = () => onSelect?.(stock.ticker);
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelect();
    }
  };

  if (!quote) {
    return (
      <tr
        className={cn(
          "border-b border-border/50 transition-colors",
          onSelect && "cursor-pointer hover:bg-muted/50",
          isSelected && "bg-blue-500/10 ring-1 ring-inset ring-blue-500/30",
        )}
        data-testid={`stock-row-${stock.ticker}`}
        tabIndex={onSelect ? 0 : undefined}
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
      >
        <td className="py-2.5 px-4">
          <div className="font-bold text-sm">{stock.ticker}</div>
          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{stock.company}</div>
        </td>
        <td colSpan={2} className="py-2.5 px-4 text-center text-muted-foreground text-sm">
          Loading...
        </td>
      </tr>
    );
  }

  const isUp = quote.change >= 0;
  const changeColor = isUp ? "text-green-500" : "text-red-500";

  const divTag = score?.divergenceTag;
  const hasDivTag = divTag && divTag.length > 0;
  const fbrs = score?.fbrs ?? 0;
  const showFbrsCaution = fbrs > 70;
  const isSuperstock = score?.isSuperstock ?? false;
  const tier = score?.convictionTier ?? 0;

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50 transition-colors group",
          onSelect && "cursor-pointer hover:bg-muted/50",
          isSelected && "bg-blue-500/10 ring-1 ring-inset ring-blue-500/30",
        )}
        data-testid={`stock-row-${stock.ticker}`}
        tabIndex={onSelect ? 0 : undefined}
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
      >
        <td className="py-2.5 px-4 align-top">
          <div className="flex items-center gap-1.5">
            {rank !== undefined && (
              <span className="font-mono text-[10px] text-zinc-600 w-4 shrink-0">{rank}</span>
            )}
            {sectorColor && (
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: sectorColor, boxShadow: `0 0 4px ${sectorColor}80` }} />
            )}
            <span className="font-bold text-sm" data-testid={`stock-ticker-${stock.ticker}`}>{stock.ticker}</span>
            {onDemand && (
              <span className="text-[8px] font-bold px-1 py-px rounded border bg-amber-500/10 text-amber-300 border-amber-500/40 leading-none">
                ON-DEMAND
              </span>
            )}
            {isSuperstock && (
              <span className="text-[11px] select-none" title="Superstock Candidate — INS ≥ 72 · ACS ≥ 68 · FBRS < 28">⭐</span>
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
          {signalDelta?.divergence && (
            <div className={cn("mt-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border inline-block", historyDivergenceStyle(signalDelta.divergence))}>
              {signalDelta.divergence}
            </div>
          )}
          {showFbrsCaution && (
            <div className="mt-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border inline-block bg-red-500/10 text-red-300 border-red-500/30">
              ⚠ CAUTION: HYPE-DRIVEN MOVE
            </div>
          )}
        </td>

        <td className="py-2.5 px-4 text-right align-top">
          <PriceCell
            price={quote.price}
            lastUpdated={quote.lastUpdated}
            prefix="$"
            testId={`stock-price-${stock.ticker}`}
            className="font-bold text-[15px]"
          />
          <div className={cn("font-mono text-xs mt-0.5", changeColor)} data-testid={`stock-change-${stock.ticker}`}>
            {isUp ? "+" : ""}{formatCurrency(quote.change)} ({formatPercent(quote.changePercent)})
          </div>
        </td>

        {/* Reason — the plain-English "why" leads; the composite score is small/secondary beneath it */}
        <td className="py-2.5 px-3 align-top">
          {score && !score.dataComplete ? (
            // Candles/fundamentals haven't both loaded for this ticker yet — the
            // score object exists but is built partly from internal defaults, not
            // real data. Must read as distinctly different from a real (possibly
            // low) score, not as another shade of "—". See StockScore.dataComplete.
            <div
              className="flex items-center gap-1.5 text-zinc-500 text-[11px] italic"
              data-testid={`score-loading-${stock.ticker}`}
              title="Data still loading for this ticker — score isn't final yet"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-600 animate-pulse shrink-0" />
              Loading full data…
            </div>
          ) : score ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
              className="flex items-center gap-2 w-full"
              aria-expanded={expanded}
              data-testid={`reason-toggle-${stock.ticker}`}
            >
              <div className="min-w-0 text-left flex-1">
                <div className={cn("text-[11px] font-bold uppercase tracking-wide leading-tight", signalLabelStyle(score.signalLabel))}>
                  {score.signalLabel}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={cn("text-[10px] font-semibold tabular-nums px-1 py-px rounded border", signalColor(score.signalScore))}>
                    {score.signalScore}
                  </span>
                  <span
                    className={cn("text-[10px] font-semibold tabular-nums px-1 py-px rounded border", rsiTone(score.rsiZone))}
                    title={score.rsi === undefined ? "RSI needs 14+ days of price history — not loaded yet" : undefined}
                  >
                    RSI {score.rsi !== undefined ? Math.round(score.rsi) : "—"}
                    {score.rsiZone === "Oversold" ? " · Oversold" : score.rsiZone === "Overbought" ? " · Overbought" : ""}
                  </span>
                </div>
              </div>
              <ChevronDown className={cn(
                "h-3.5 w-3.5 text-zinc-600 shrink-0 transition-transform",
                expanded && "rotate-180",
              )} />
            </button>
          ) : <span className="text-muted-foreground text-xs">—</span>}
        </td>
      </tr>
      {expanded && score && (
        <tr className="border-b border-border/50">
          <td colSpan={3} className="p-0">
            <DetailsPanel score={score} focus={stock.focus} />
          </td>
        </tr>
      )}
    </>
  );
}
