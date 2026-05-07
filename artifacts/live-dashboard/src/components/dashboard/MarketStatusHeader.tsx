import { useGetMarketStatus } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";

// Returns the 2nd Sunday of March or 1st Sunday of November (UTC ms)
function nthSunday(year: number, month: number, n: number): number {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const dow = firstOfMonth.getUTCDay(); // 0 = Sunday
  const firstSunday = dow === 0 ? 1 : 8 - dow;
  return Date.UTC(year, month, firstSunday + (n - 1) * 7);
}

// Compute Eastern time string directly from UTC arithmetic — no browser locale APIs
function getEasternTimeString(): string {
  const utcMs = Date.now();
  const year = new Date(utcMs).getUTCFullYear();

  // EDT starts: 2nd Sunday in March at 2am EST (= 7am UTC)
  const dstStart = nthSunday(year, 2, 2) + 7 * 3600_000;
  // EDT ends: 1st Sunday in November at 2am EDT (= 6am UTC)
  const dstEnd = nthSunday(year, 10, 1) + 6 * 3600_000;

  const offsetMs = (utcMs >= dstStart && utcMs < dstEnd ? -4 : -5) * 3600_000;
  const et = new Date(utcMs + offsetMs);

  const hh = et.getUTCHours();
  const mm = String(et.getUTCMinutes()).padStart(2, "0");
  const ss = String(et.getUTCSeconds()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return `${MONTHS[et.getUTCMonth()]} ${et.getUTCDate()}, ${et.getUTCFullYear()} ${h12}:${mm}:${ss} ${ampm} ET`;
}

function useEasternClock() {
  const [display, setDisplay] = useState(getEasternTimeString);
  useEffect(() => {
    const timer = setInterval(() => setDisplay(getEasternTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);
  return display;
}

export function MarketStatusHeader() {
  const { data: status, isLoading, isError } = useGetMarketStatus({
    query: { refetchInterval: 30000, queryKey: ["market-status"] }
  });

  const clockDisplay = useEasternClock();

  if (isLoading) {
    return (
      <div className="flex items-center justify-between py-4 px-6 border-b border-border bg-card">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-6 w-32" />
      </div>
    );
  }

  if (isError || !status) {
    return null;
  }

  return (
    <div className="flex items-center justify-between py-3 px-6 border-b border-border bg-card/50 backdrop-blur">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          ATDEVALA STOCK WATCHLIST
        </h1>
        <div className="h-4 w-px bg-border"></div>
        <div className="flex items-center gap-2" data-testid="market-status">
          <div className={`w-2 h-2 rounded-full ${status.isOpen ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse" : "bg-red-500"}`}></div>
          <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {status.isOpen ? "Market Open" : "Market Closed"}
          </span>
          <span className="text-xs text-muted-foreground/60 uppercase tracking-widest px-2 py-0.5 rounded bg-muted">
            {status.session}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground">
        <div data-testid="market-timezone">US (America/New_York)</div>
        <div data-testid="current-time">{clockDisplay}</div>
      </div>
    </div>
  );
}
