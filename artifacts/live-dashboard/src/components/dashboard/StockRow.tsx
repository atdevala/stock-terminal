import type { Quote, StockInfo, StockScore } from "@workspace/api-client-react";
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

function divergenceStyle(tag: string): string {
  if (tag === "EARLY OPPORTUNITY")  return "bg-yellow-500/15 text-yellow-300 border-yellow-500/30";
  if (tag === "LATE STAGE RISK")    return "bg-red-500/15 text-red-300 border-red-500/30";
  if (tag === "HIGH CONVICTION")    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return "";
}

function fmt(v: number | undefined, suffix = "%", decimals = 1): string {
  if (v === undefined || v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}${suffix}`;
}

function ScoreBadge({
  label,
  score,
  colorFn,
  tooltip,
}: {
  label: string;
  score: number;
  colorFn?: (s: number) => string;
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
      {/* Header */}
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
      {/* Sub-component breakdown */}
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

export function StockRow({ stock, quote, score }: StockRowProps) {
  if (!quote) {
    return (
      <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors">
        <td className="py-2.5 px-4">
          <div className="font-bold text-sm">{stock.ticker}</div>
          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{stock.company}</div>
        </td>
        <td colSpan={11} className="py-2.5 px-4 text-center text-muted-foreground text-sm">
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

  return (
    <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors group" data-testid={`stock-row-${stock.ticker}`}>
      <td className="py-2.5 px-4 align-top">
        <div className="font-bold text-sm" data-testid={`stock-ticker-${stock.ticker}`}>{stock.ticker}</div>
        <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={stock.company}>{stock.company}</div>
        {hasDivTag && (
          <div className={cn("mt-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border inline-block", divergenceStyle(divTag))}>
            {divTag}
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
            tooltip={<InsTooltipContent score={score} />}
          />
        ) : <span className="text-muted-foreground text-xs">—</span>}
      </td>

      <td className="py-2.5 px-4 text-center text-muted-foreground text-xs align-top hidden lg:table-cell">
        <div>{stock.focus}</div>
      </td>
    </tr>
  );
}
