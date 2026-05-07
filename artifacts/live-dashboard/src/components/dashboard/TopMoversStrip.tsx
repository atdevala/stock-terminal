import { useGetMovers } from "@workspace/api-client-react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { formatPercent } from "@/lib/formatters";

export function TopMoversStrip() {
  const { data: movers, isLoading } = useGetMovers({
    query: { refetchInterval: 5000, queryKey: ["movers"] }
  });

  if (isLoading || !movers) {
    return <div className="h-10 border-b border-border bg-muted/20 animate-pulse"></div>;
  }

  const items = [
    ...movers.gainers.map((stock, i) => (
      <div key={`g-${stock.ticker}-${i}`} className="flex items-center gap-2 mr-10" data-testid={`mover-gainer-${stock.ticker}`}>
        <span className="font-bold text-foreground">{stock.ticker}</span>
        <span className="text-foreground">${stock.price.toFixed(2)}</span>
        <span className="text-green-500 flex items-center gap-0.5">
          <ArrowUpIcon className="w-3 h-3" />
          {stock.changePercent.toFixed(2)}%
        </span>
      </div>
    )),
    ...movers.losers.map((stock, i) => (
      <div key={`l-${stock.ticker}-${i}`} className="flex items-center gap-2 mr-10" data-testid={`mover-loser-${stock.ticker}`}>
        <span className="font-bold text-foreground">{stock.ticker}</span>
        <span className="text-foreground">${stock.price.toFixed(2)}</span>
        <span className="text-red-500 flex items-center gap-0.5">
          <ArrowDownIcon className="w-3 h-3" />
          {stock.changePercent.toFixed(2)}%
        </span>
      </div>
    )),
  ];

  return (
    <div className="flex items-center h-10 border-b border-border bg-muted/10 overflow-hidden text-xs font-mono whitespace-nowrap">
      <div className="flex-none px-4 py-2 font-semibold text-green-500 border-r border-border bg-green-500/10 flex items-center h-full">
        TOP GAINERS
      </div>
      <div className="flex-1 overflow-hidden relative">
        <div className="flex items-center ticker-scroll">
          {items}
          {/* Duplicate for seamless loop */}
          {items.map((item, i) => (
            <div key={`dup-${i}`}>{item}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
