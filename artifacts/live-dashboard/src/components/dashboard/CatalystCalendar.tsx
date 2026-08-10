import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@ant/api-client-react";
import { Calendar, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

// This panel is deliberately NOT another derived score. It shows real dates —
// upcoming earnings reports and known macro events — pulled from the backend's
// /catalysts endpoint. It sits above the Watchlist/Scanner toggle so it's
// visible no matter which tab is active, instead of being buried behind CPE
// (a price/volume-derived guess) on one tab only.

interface EarningsEvent {
  ticker: string;
  date: string;
  hour: "bmo" | "amc" | "dmh" | "unknown";
  onWatchlist: boolean;
  epsEstimate?: number;
}

interface MacroEvent {
  name: string;
  date: string;
  category: "inflation" | "fed" | "employment" | "other";
}

interface CatalystCalendarData {
  macro: MacroEvent[];
  earnings: EarningsEvent[];
}

function formatDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function hourLabel(hour: EarningsEvent["hour"]): string {
  if (hour === "bmo") return "before open";
  if (hour === "amc") return "after close";
  if (hour === "dmh") return "during hours";
  return "";
}

export function CatalystCalendar() {
  const { data, isLoading } = useQuery<CatalystCalendarData>({
    queryKey: ["catalysts"],
    queryFn: () => customFetch<CatalystCalendarData>("/api/catalysts?days=10"),
    staleTime: 5 * 60 * 1000,
  });

  const earnings = (data?.earnings ?? []).slice(0, 8);
  const macro = data?.macro ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 py-3">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-zinc-200">
          <Globe className="h-4 w-4 text-sky-400" />
          Market-wide catalysts
        </div>
        {isLoading && <div className="text-xs text-zinc-500">Loading…</div>}
        {!isLoading && macro.length === 0 && (
          <div className="text-xs text-zinc-500">
            No macro events configured for this window — add release dates to{" "}
            <code className="text-zinc-400">catalysts.ts</code>.
          </div>
        )}
        {macro.map(ev => (
          <div
            key={`${ev.name}-${ev.date}`}
            className="flex items-center justify-between text-xs py-1.5 border-b border-zinc-800/60 last:border-0"
          >
            <span className="text-zinc-300">{ev.name}</span>
            <span className="text-zinc-500">{formatDay(ev.date)}</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-zinc-200">
          <Calendar className="h-4 w-4 text-amber-400" />
          Earnings to watch
        </div>
        {isLoading && <div className="text-xs text-zinc-500">Loading…</div>}
        {!isLoading && earnings.length === 0 && (
          <div className="text-xs text-zinc-500">No earnings reports in this window.</div>
        )}
        {earnings.map(ev => (
          <div
            key={`${ev.ticker}-${ev.date}`}
            className="flex items-center justify-between text-xs py-1.5 border-b border-zinc-800/60 last:border-0"
          >
            <span className={cn("font-mono", ev.onWatchlist ? "text-sky-300 font-semibold" : "text-zinc-300")}>
              {ev.ticker}
            </span>
            <span className="text-zinc-500">
              {formatDay(ev.date)}
              {hourLabel(ev.hour) ? ` · ${hourLabel(ev.hour)}` : ""}
              {ev.onWatchlist ? " · on your list" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
