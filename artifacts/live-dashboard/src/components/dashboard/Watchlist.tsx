import {
  useGetStocks,
  useGetQuotes,
  useGetScores,
  getGetQuotesQueryKey,
  getGetScoresQueryKey,
} from "@workspace/api-client-react";
import { StockRow } from "./StockRow";
import { stripEmoji } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Watchlist() {
  const { data: categories, isLoading: isLoadingStocks } = useGetStocks();

  const { data: quotesData } = useGetQuotes({
    query: { refetchInterval: 1500, queryKey: getGetQuotesQueryKey() },
  });

  const { data: scoresData } = useGetScores({
    query: { refetchInterval: 30_000, queryKey: getGetScoresQueryKey() },
  });

  if (isLoadingStocks || !categories) {
    return (
      <div className="p-6 space-y-8">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const quotesMap = new Map(quotesData?.quotes?.map(q => [q.ticker, q]) ?? []);
  const scoresMap = new Map(scoresData?.map(s => [s.ticker, s]) ?? []);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-10">
      {categories.map((category) => (
        <section key={category.name} className="space-y-4" data-testid={`category-${category.name}`}>
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full shadow-sm"
              style={{ backgroundColor: `#${category.color}`, boxShadow: `0 0 8px #${category.color}80` }}
            />
            <h2 className="text-lg font-bold tracking-tight text-foreground uppercase">
              {stripEmoji(category.name)}
            </h2>
            <div className="h-px flex-1 bg-border/50 ml-4" />
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <th className="py-3 px-4 font-medium">Symbol/Company</th>
                  <th className="py-3 px-4 font-medium text-right">Price</th>
                  <th className="py-3 px-4 font-medium text-right">CHG $</th>
                  <th className="py-3 px-4 font-medium text-right">Day Chg %</th>
                  <th className="py-3 px-4 font-medium text-right">Ext Chg %</th>
                  <th className="py-3 px-4 font-medium text-right">Day H/L</th>
                  <th className="py-3 px-4 font-medium text-right hidden md:table-cell">52W H/L</th>
                  <th className="py-3 px-4 font-medium text-right hidden sm:table-cell">P/E</th>
                  <th className="py-3 px-4 font-medium text-center hidden xl:table-cell">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help underline decoration-dotted underline-offset-2">VQS</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-center">
                        Look for VQS &gt; 55 — This filters out hype stocks with no real business, companies burning cash with no path forward
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-3 px-4 font-medium text-center hidden xl:table-cell">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help underline decoration-dotted underline-offset-2">GVS</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-center">
                        Look for GVS &gt; 70 — These are potential break out stocks / early momentum names
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-3 px-4 font-medium text-center hidden xl:table-cell">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help underline decoration-dotted underline-offset-2">COS</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-center">
                        Look for COS &gt; 70 — These are your best setups. Good business, Strong Momentum, Aligned Fundamentals + Trend. This tells you what is actually worth risking money on
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-3 px-4 font-medium text-center hidden lg:table-cell">Focus</th>
                </tr>
              </thead>
              <tbody>
                {category.stocks.map(stock => (
                  <StockRow
                    key={stock.ticker}
                    stock={stock}
                    quote={quotesMap.get(stock.ticker)}
                    score={scoresMap.get(stock.ticker)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
