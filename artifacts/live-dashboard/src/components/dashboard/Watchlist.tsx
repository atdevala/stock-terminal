import { useState } from "react";
import {
  useGetStocks,
  useGetQuotes,
  useGetScores,
  getGetQuotesQueryKey,
  getGetScoresQueryKey,
  type StockScore,
} from "@workspace/api-client-react";
import { StockRow } from "./StockRow";
import { stripEmoji } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type FilterKey = "all" | "ins70" | "cos70" | "early" | "highConv";

const FILTERS: { key: FilterKey; label: string; color: string }[] = [
  { key: "all",      label: "All Stocks",        color: "border-zinc-600 text-zinc-400 hover:border-zinc-400 hover:text-zinc-200" },
  { key: "ins70",    label: "INS > 70",           color: "border-violet-600 text-violet-400 hover:border-violet-400 hover:text-violet-200" },
  { key: "cos70",    label: "COS > 70",           color: "border-blue-600 text-blue-400 hover:border-blue-400 hover:text-blue-200" },
  { key: "early",    label: "⚡ Early Opportunity", color: "border-yellow-600 text-yellow-400 hover:border-yellow-400 hover:text-yellow-200" },
  { key: "highConv", label: "🔥 High Conviction",  color: "border-emerald-600 text-emerald-400 hover:border-emerald-400 hover:text-emerald-200" },
];

const ACTIVE_COLORS: Record<FilterKey, string> = {
  all:      "bg-zinc-700 border-zinc-500 text-white",
  ins70:    "bg-violet-900/60 border-violet-500 text-violet-200",
  cos70:    "bg-blue-900/60 border-blue-500 text-blue-200",
  early:    "bg-yellow-900/60 border-yellow-500 text-yellow-200",
  highConv: "bg-emerald-900/60 border-emerald-500 text-emerald-200",
};

function matchesFilter(score: StockScore | undefined, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (!score) return false;
  const ins = score.ins ?? 0;
  const cos = score.cos;
  if (filter === "ins70")    return ins > 70;
  if (filter === "cos70")    return cos > 70;
  if (filter === "early")    return ins > 70 && cos < 60;
  if (filter === "highConv") return ins > 70 && cos > 70;
  return true;
}

export function Watchlist() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const { data: categories, isLoading: isLoadingStocks } = useGetStocks();

  const { data: quotesData } = useGetQuotes({
    query: { refetchInterval: 1500, queryKey: getGetQuotesQueryKey() },
  });

  const { data: scoresData } = useGetScores({
    query: { refetchInterval: 5_000, queryKey: getGetScoresQueryKey() },
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
    <div className="flex-1 overflow-auto p-6 space-y-6">

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-widest mr-1">Filter:</span>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={cn(
              "text-xs font-medium px-3 py-1 rounded border transition-colors duration-150",
              activeFilter === f.key ? ACTIVE_COLORS[f.key] : f.color
            )}
          >
            {f.label}
          </button>
        ))}
        {activeFilter !== "all" && (
          <span className="text-xs text-muted-foreground ml-2">
            {categories.flatMap(c => c.stocks).filter(s => matchesFilter(scoresMap.get(s.ticker), activeFilter)).length} matches
          </span>
        )}
      </div>

      {/* ── Category tables ── */}
      <div className="space-y-10">
        {categories.map((category) => {
          const visibleStocks = category.stocks.filter(s =>
            matchesFilter(scoresMap.get(s.ticker), activeFilter)
          );
          if (activeFilter !== "all" && visibleStocks.length === 0) return null;

          return (
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
                          <TooltipContent side="top" className="max-w-sm text-left p-3 space-y-2" style={{ background: '#000000', border: '1px solid #333' }}>
                            <p className="font-semibold text-white">(Valuation Quality Score)</p>
                            <p className="text-zinc-300 text-xs">Measures how fundamentally strong and reasonably priced a company is. Higher VQS = Stronger business quality relative to price.</p>
                            <div className="text-xs space-y-0.5 border-t border-zinc-700 pt-2">
                              <div><span className="text-emerald-400 font-mono">80+</span><span className="text-zinc-300"> → high-quality undervalued growth</span></div>
                              <div><span className="text-emerald-400 font-mono">65–79</span><span className="text-zinc-300"> → strong fundamentals</span></div>
                              <div><span className="text-yellow-400 font-mono">50–64</span><span className="text-zinc-300"> → mixed / fair value</span></div>
                              <div><span className="text-red-400 font-mono">below 50</span><span className="text-zinc-300"> → weaker fundamentals or overpriced</span></div>
                            </div>
                            <p className="text-zinc-400 text-xs italic border-t border-zinc-700 pt-2">Use VQS to filter out weak hype stocks and identify companies with sustainable long-term strength.</p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="py-3 px-4 font-medium text-center hidden xl:table-cell">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2">GVS</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm text-left p-3 space-y-2" style={{ background: '#000000', border: '1px solid #333' }}>
                            <p className="font-semibold text-white">(Growth Volatility Score)</p>
                            <p className="text-zinc-300 text-xs">Measures how strong a stock's growth, momentum, and breakout potential currently are. Higher GVS = Stronger momentum and higher probability of a major breakout move.</p>
                            <div className="text-xs space-y-0.5 border-t border-zinc-700 pt-2">
                              <div><span className="text-emerald-400 font-mono">85+</span><span className="text-zinc-300"> → explosive breakout setup</span></div>
                              <div><span className="text-emerald-400 font-mono">70–84</span><span className="text-zinc-300"> → strong momentum growth stock</span></div>
                              <div><span className="text-yellow-400 font-mono">55–69</span><span className="text-zinc-300"> → early-stage or re-accelerating growth</span></div>
                              <div><span className="text-orange-400 font-mono">40–54</span><span className="text-zinc-300"> → weakening momentum</span></div>
                              <div><span className="text-red-400 font-mono">below 40</span><span className="text-zinc-300"> → broken or low-interest growth story</span></div>
                            </div>
                            <p className="text-zinc-400 text-xs italic border-t border-zinc-700 pt-2">Use GVS to identify stocks gaining institutional attention and entering strong growth cycles.</p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="py-3 px-4 font-medium text-center hidden xl:table-cell">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2">COS</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm text-left p-3 space-y-2" style={{ background: '#000000', border: '1px solid #333' }}>
                            <p className="font-semibold text-white">(Combined Opportunity Score)</p>
                            <p className="text-zinc-300 text-xs">Blends VQS and GVS into one overall opportunity score that balances business quality, valuation, growth acceleration, and breakout potential. Higher COS = Strongest combination of quality fundamentals and upside momentum.</p>
                            <div className="text-xs space-y-0.5 border-t border-zinc-700 pt-2">
                              <div><span className="text-emerald-400 font-mono">80+</span><span className="text-zinc-300"> → elite growth opportunity</span></div>
                              <div><span className="text-emerald-400 font-mono">70–79</span><span className="text-zinc-300"> → strong risk/reward setup</span></div>
                              <div><span className="text-yellow-400 font-mono">55–69</span><span className="text-zinc-300"> → decent but incomplete setup</span></div>
                              <div><span className="text-orange-400 font-mono">40–54</span><span className="text-zinc-300"> → weak or inconsistent signals</span></div>
                              <div><span className="text-red-400 font-mono">below 40</span><span className="text-zinc-300"> → avoid / low conviction</span></div>
                            </div>
                            <p className="text-zinc-400 text-xs italic border-t border-zinc-700 pt-2">Use COS to rank the best overall opportunities after filtering for both quality and momentum.</p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="py-3 px-4 font-medium text-center hidden xl:table-cell">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2 text-violet-400">INS</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm text-left p-3 space-y-2" style={{ background: '#000000', border: '1px solid #333' }}>
                            <p className="font-semibold text-violet-300">(Inflection Signal Score)</p>
                            <p className="text-zinc-300 text-xs">A leading indicator that detects early-stage breakout setups BEFORE they show up in high COS scores. Combines momentum acceleration, volume surges, earnings surprises, and relative strength.</p>
                            <div className="text-xs space-y-0.5 border-t border-zinc-700 pt-2">
                              <div><span className="text-emerald-400 font-mono">80+</span><span className="text-zinc-300"> → explosive early breakout</span></div>
                              <div><span className="text-emerald-400 font-mono">65–79</span><span className="text-zinc-300"> → early momentum building</span></div>
                              <div><span className="text-yellow-400 font-mono">50–64</span><span className="text-zinc-300"> → neutral / developing</span></div>
                              <div><span className="text-orange-400 font-mono">30–49</span><span className="text-zinc-300"> → weak / no edge</span></div>
                              <div><span className="text-red-400 font-mono">below 30</span><span className="text-zinc-300"> → avoid</span></div>
                            </div>
                            <div className="text-xs border-t border-zinc-700 pt-2 space-y-0.5">
                              <div className="text-zinc-400 font-semibold mb-1">Formula (0–100):</div>
                              <div className="text-zinc-400">25% Delta GVS · 20% Volume Accel</div>
                              <div className="text-zinc-400">20% Narrative Momentum · 20% EPS Slope</div>
                              <div className="text-zinc-400">15% Delta VQS</div>
                            </div>
                            <p className="text-zinc-400 text-xs italic border-t border-zinc-700 pt-2">INS leads COS by 2–6 weeks in emerging winners. High INS + low COS = pre-breakout candidate.</p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="py-3 px-4 font-medium text-center hidden 2xl:table-cell">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-2 text-teal-500">ACS</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-sm text-left p-3 space-y-2" style={{ background: '#000000', border: '1px solid #333' }}>
                            <p className="font-semibold text-teal-300">(Accumulation Confidence Score)</p>
                            <p className="text-zinc-300 text-xs">Detects quiet institutional accumulation before it becomes public knowledge. Combines up-volume ratio, relative strength vs SPY, price compression (coiling), volume surge, and closing strength.</p>
                            <div className="text-xs space-y-0.5 border-t border-zinc-700 pt-2">
                              <div><span className="text-teal-300 font-mono">80+</span><span className="text-zinc-300"> → strong institutional accumulation</span></div>
                              <div><span className="text-teal-400 font-mono">60–79</span><span className="text-zinc-300"> → moderate accumulation</span></div>
                              <div><span className="text-zinc-400 font-mono">below 60</span><span className="text-zinc-300"> → weak / no detectable accumulation</span></div>
                            </div>
                            <p className="text-zinc-400 text-xs italic border-t border-zinc-700 pt-2">High ACS + high INS = institutional buying before market consensus forms.</p>
                          </TooltipContent>
                        </Tooltip>
                      </th>
                      <th className="py-3 px-4 font-medium text-center hidden lg:table-cell">Focus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStocks.map(stock => (
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
          );
        })}
      </div>
    </div>
  );
}
