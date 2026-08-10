import { useState } from "react";
import { Activity, LayoutDashboard } from "lucide-react";
import { MarketStatusHeader } from "@/components/dashboard/MarketStatusHeader";
import { TopMoversStrip } from "@/components/dashboard/TopMoversStrip";
import { CatalystCalendar } from "@/components/dashboard/CatalystCalendar";
import { Watchlist } from "@/components/dashboard/Watchlist";
import {
  WorkstationShell,
  type WorkstationTab,
} from "@/components/workstation/WorkstationShell";
import { AlphaScannerPage } from "@/pages/AlphaScannerPage";

type AppTab = "watchlist" | "alpha";

const TABS: WorkstationTab[] = [
  {
    key: "watchlist",
    label: "Watchlist",
    description: "Signal-ranked sector watchlist",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    key: "alpha",
    label: "Scanner",
    description: "Cross-universe alpha discovery",
    icon: <Activity className="h-4 w-4" />,
  },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<AppTab>("watchlist");

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden selection:bg-primary selection:text-primary-foreground">
      <header className="flex-none z-10 sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <MarketStatusHeader />
        <TopMoversStrip />
      </header>

      <main className="flex-1 overflow-hidden flex flex-col relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.015] mix-blend-overlay bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIi8+CjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMwMDAiLz4KPC9zdmc+')]" />
        <WorkstationShell
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={tab => setActiveTab(tab as AppTab)}
        >
          <CatalystCalendar />
          {activeTab === "watchlist" && <Watchlist />}
          {activeTab === "alpha" && <AlphaScannerPage />}
        </WorkstationShell>
      </main>
    </div>
  );
}
