import { useGetMarketStatus } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";

const NY_TZ = "America/New_York";

function useNYClock() {
  const [display, setDisplay] = useState(() => getNYTimeString());

  useEffect(() => {
    const tick = () => setDisplay(getNYTimeString());
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  return display;
}

function getNYTimeString(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString("en-US", {
    timeZone: NY_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = now.toLocaleTimeString("en-US", {
    timeZone: NY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  return `${datePart} ${timePart}`;
}

export function MarketStatusHeader() {
  const { data: status, isLoading, isError } = useGetMarketStatus({
    query: { refetchInterval: 30000 }
  });

  const clockDisplay = useNYClock();

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
