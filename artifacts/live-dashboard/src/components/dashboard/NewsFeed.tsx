import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

// Template-based "why is this stock moving" feed — see api-server's lib/news.ts.
// No AI calls anywhere in this feature; the blurb text is generated
// server-side from a fixed sentence template plus the real headline text.
// Kept deliberately simple here too: a plain list, not another card-heavy
// dashboard section, per the "reduce, don't add clutter" direction.

interface NewsBlurb {
  ticker: string;
  company: string;
  blurb: string;
  headline: string;
  source: string;
  url: string;
  changePercent: number;
  newsTimestamp: number;
}

function timeAgo(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function BlurbRow({ item }: { item: NewsBlurb }) {
  const isUp = item.changePercent >= 0;
  return (
    <a
      href={item.url || undefined}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex items-start justify-between gap-3 px-1 py-2 border-b border-zinc-800/60 last:border-b-0",
        item.url && "hover:bg-zinc-900/40 cursor-pointer",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-xs text-zinc-100">{item.ticker}</span>
          <span className={cn("text-[10px] font-mono", isUp ? "text-emerald-400" : "text-red-400")}>
            {isUp ? "+" : ""}{item.changePercent.toFixed(1)}%
          </span>
          <span className="text-[10px] text-zinc-600">·</span>
          <span className="text-[10px] text-zinc-500">{item.source}</span>
        </div>
        <p className="text-[12px] text-zinc-400 leading-snug mt-0.5">{item.blurb}</p>
      </div>
      <span className="text-[10px] text-zinc-600 shrink-0 pt-0.5">{timeAgo(item.newsTimestamp)}</span>
    </a>
  );
}

export function NewsFeed() {
  const { data, isLoading, isError } = useQuery<NewsBlurb[]>({
    queryKey: ["news-blurbs"],
    queryFn: () => fetch("/api/news-blurbs").then(r => {
      if (!r.ok) throw new Error("Failed to load news blurbs");
      return r.json();
    }),
    refetchInterval: 5 * 60_000,
  });

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
        <h2 className="text-sm font-bold text-zinc-100">Why Stocks Are Moving</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Real news headlines for names moving 5%+ today — template-generated, not AI-written.
        </p>
      </div>
      <div className="px-3">
        {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full my-2 rounded" />)}
        {isError && <p className="text-sm text-red-400 px-1 py-4">Couldn't load news.</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-zinc-500 px-1 py-4">No notable moves with matching recent news right now.</p>
        )}
        {data?.map(item => <BlurbRow key={`${item.ticker}-${item.newsTimestamp}`} item={item} />)}
      </div>
    </section>
  );
}
