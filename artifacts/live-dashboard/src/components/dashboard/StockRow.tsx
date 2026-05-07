import type { Quote, StockInfo } from "@workspace/api-client-react";
import { PriceCell } from "./PriceCell";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface StockRowProps {
  stock: StockInfo;
  quote?: Quote;
}

export function StockRow({ stock, quote }: StockRowProps) {
  if (!quote) {
    return (
      <tr className="border-b border-border/50 hover:bg-muted/50 transition-colors">
        <td className="py-2.5 px-4">
          <div className="font-bold text-sm">{stock.ticker}</div>
          <div className="text-xs text-muted-foreground truncate max-w-[150px]">{stock.company}</div>
        </td>
        <td colSpan={7} className="py-2.5 px-4 text-center text-muted-foreground text-sm">
          Loading quote data...
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
      <td className="py-2.5 px-4 text-center text-muted-foreground text-xs align-top hidden lg:table-cell">
        <div>{stock.focus}</div>
      </td>
    </tr>
  );
}
