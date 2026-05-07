import { MarketStatusHeader } from "@/components/dashboard/MarketStatusHeader";
import { TopMoversStrip } from "@/components/dashboard/TopMoversStrip";
import { Watchlist } from "@/components/dashboard/Watchlist";

export default function Dashboard() {
  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden selection:bg-primary selection:text-primary-foreground">
      <header className="flex-none z-10 sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <MarketStatusHeader />
        <TopMoversStrip />
      </header>
      <main className="flex-1 overflow-hidden flex flex-col relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.015] mix-blend-overlay bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIi8+CjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMwMDAiLz4KPC9zdmc+')]"></div>
        <Watchlist />
      </main>
    </div>
  );
}
