import { useState } from "react";
import { MarketStatusHeader } from "@/components/dashboard/MarketStatusHeader";
import { TopMoversStrip } from "@/components/dashboard/TopMoversStrip";
import { Watchlist } from "@/components/dashboard/Watchlist";
import { AlphaScannerPage } from "@/pages/AlphaScannerPage";
import { cn } from "@/lib/utils";

type AppTab = "watchlist" | "alpha";

const TABS: { key: AppTab; label: string }[] = [
  { key: "watchlist", label: "Watchlist" },
  { key: "alpha",     label: "⚡ Scanner" },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<AppTab>("watchlist");

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden selection:bg-primary selection:text-primary-foreground">
      <header className="flex-none z-10 sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <MarketStatusHeader />
        <TopMoversStrip />
        {/* Tab navigation */}
        <div className="flex border-b border-border bg-card/10 px-4 sm:px-6">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-150 whitespace-nowrap",
                activeTab === tab.key
                  ? "border-amber-500 text-amber-300"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-zinc-600"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.015] mix-blend-overlay bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIi8+CjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMwMDAiLz4KPC9zdmc+')]" />
        {activeTab === "watchlist" && <Watchlist />}
        {activeTab === "alpha"     && <AlphaScannerPage />}
      </main>
    </div>
  );
}
