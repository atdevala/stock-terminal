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

function fmt(v: number | undefined, suffix = "%", decimals = 1): string {
  if (v === undefined || v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}${suffix}`;
}

function ScoreBadge({
  label,
  score,
  tooltip,
}: {
  label: string;
  score: number;
  tooltip: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "inline-flex flex-col items-center cursor-help rounded border px-1.5 py-0.5 w-14 select-none",
            scoreColor(score)
          )}
          data-testid={`score-badge-${label}`}
        >
          <span className="font-bold text-sm leading-tight">{score}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[260px] p-0 overflow-hidden">
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
    ["Price > 50MA",   score.priceAbove50MA !== undefined ? (score.priceAbove50MA ? "Yes" : "No") : "—"],
    ["Price > 200MA",  score.priceAbove200MA !== undefined ? (score.priceAbove200MA ? "Yes" : "No") : "—"],
    ["Analyst Trend",  score.earningsRevisionsUp !== undefined ? (score.earningsRevisionsUp ? "Bullish" : "Bearish") : "—"],
  ];

  return (
    <div className="text-xs">
      <div className="grid grid-cols-3 gap-0 border-b border-border px-3 py-2 font-semibold text-foreground bg-muted/30">
        <div className="text-center">
          <div className="text-muted-foreground uppercase tracking-wide text-[10px]">VQS</div>
          <div className={cn("text-base font-bold", scoreColor(score.vqs).split(" ")[0])}>{score.vqs}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{score.vqsLabel}</div>
        </div>
        <div className="text-center border-x border-border">
          <div className="text-muted-foreground uppercase tracking-wide text-[10px]">GVS</div>
          <div className={cn("text-base font-bold", scoreColor(score.gvs).split(" ")[0])}>{score.gvs}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{score.gvsLabel}</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground uppercase tracking-wide text-[10px]">COS</div>
          <div className={cn("text-base font-bold", scoreColor(score.cos).split(" ")[0])}>{score.cos}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{score.cosLabel}</div>
        </div>
      </div>
      <div className="px-3 py-2 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono text-foreground">{v}</span>
          </div>
        ))}
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
        <td colSpan={10} className="py-2.5 px-4 text-center text-muted-foreground text-sm">
          Loading...
        </td>
      </tr>
    );
  }

  const isUp = quote.change >= 0;
  const changeColor = isUp ? "text-green-500" : "text-red-500";

  return (
    <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors group" data-testid={`stock-row-${stock.ticker}`}>
      <td className="py-2.5 px-4 align-top">
        <div className="font-bold text-sm" data-testid={`stock-ticker-${stock.ticker}`}>{stock.ticker}</div>
        <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={stock.company}>{stock.company}</div>
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
        <div className={cn("font-mono text-sm", changeColor)} data-testid={`stock-change-${stock.ticker}`}>
          {isUp ? "+" : ""}{formatCurrency(quote.change)}
        </div>
      </td>
      <td className="py-2.5 px-4 text-right align-top">
        <div className={cn("font-mono text-sm", changeColor)} data-testid={`stock-change-percent-${stock.ticker}`}>
          {formatPercent(quote.changePercent)}
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

      {/* Score columns */}
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score ? (
          <ScoreBadge
            label={`vqs-${stock.ticker}`}
            score={score.vqs}
            tooltip={<ScoreTooltipContent score={score} />}
          />
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score ? (
          <ScoreBadge
            label={`gvs-${stock.ticker}`}
            score={score.gvs}
            tooltip={<ScoreTooltipContent score={score} />}
          />
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="py-2.5 px-3 text-center align-middle hidden xl:table-cell">
        {score ? (
          <ScoreBadge
            label={`cos-${stock.ticker}`}
            score={score.cos}
            tooltip={<ScoreTooltipContent score={score} />}
          />
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>

      <td className="py-2.5 px-4 text-center text-muted-foreground text-xs align-top hidden lg:table-cell">
        <div>{stock.focus}</div>
      </td>
    </tr>
  );
}
