import { useGetMovers } from "@workspace/api-client-react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { formatPercent } from "@/lib/formatters";

export function TopMoversStrip() {
  const { data: movers, isLoading } = useGetMovers({
    query: { refetchInterval: 5000 }
  });

  if (isLoading || !movers) {
    return <div className="h-10 border-b border-border bg-muted/20 animate-pulse"></div>;
  }

  return (
    <div className="flex items-center h-10 border-b border-border bg-muted/10 overflow-hidden text-xs font-mono whitespace-nowrap">
      <div className="px-4 py-2 font-semibold text-green-500 border-r border-border bg-green-500/10 flex items-center">
        TOP GAINERS
      </div>
      <div className="flex items-center flex-1 overflow-x-auto no-scrollbar scroll-smooth">
        <div className="flex items-center px-4 animate-[scroll_30s_linear_infinite] hover:[animation-play-state:paused]">
          {movers.gainers.map((stock, i) => (
            <div key={`${stock.ticker}-g-${i}`} className="flex items-center gap-2 mr-8" data-testid={`mover-gainer-${stock.ticker}`}>
              <span className="font-bold text-foreground">{stock.ticker}</span>
              <span className="text-muted-foreground truncate max-w-[100px]">{stock.company}</span>
              <span className="text-foreground">${stock.price.toFixed(2)}</span>
              <span className="text-green-500 flex items-center">
                <ArrowUpIcon className="w-3 h-3 mr-0.5" />
                {stock.changePercent.toFixed(2)}%
              </span>
            </div>
          ))}
          <div className="w-px h-4 bg-border mx-4"></div>
          {movers.losers.map((stock, i) => (
            <div key={`${stock.ticker}-l-${i}`} className="flex items-center gap-2 mr-8" data-testid={`mover-loser-${stock.ticker}`}>
              <span className="font-bold text-foreground">{stock.ticker}</span>
              <span className="text-muted-foreground truncate max-w-[100px]">{stock.company}</span>
              <span className="text-foreground">${stock.price.toFixed(2)}</span>
              <span className="text-red-500 flex items-center">
                <ArrowDownIcon className="w-3 h-3 mr-0.5" />
                {stock.changePercent.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
