import type { ReactNode } from "react";
import {
  Activity,
  Brain,
  Database,
  LayoutDashboard,
  PanelRight,
  Radar,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkstationTab = {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
};

type WorkstationShellProps = {
  tabs: WorkstationTab[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: ReactNode;
};

const readiness = [
  {
    label: "Market Data",
    value: "Finnhub primary",
    detail: "Provider router ready",
    icon: Database,
  },
  {
    label: "Signal Engine",
    value: "Legacy factors registered",
    detail: "VQS/GVS/COS/INS active",
    icon: Activity,
  },
  {
    label: "Options + AI",
    value: "Service shells ready",
    detail: "Awaiting normalized data",
    icon: Brain,
  },
];

export function WorkstationShell({
  tabs,
  activeTab,
  onTabChange,
  children,
}: WorkstationShellProps) {
  const active = tabs.find(tab => tab.key === activeTab) ?? tabs[0];

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden border-t border-border/70 bg-background">
      <aside className="hidden w-[76px] flex-none border-r border-border/70 bg-zinc-950/50 md:flex md:flex-col md:items-center md:py-4">
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300">
          <Radar className="h-5 w-5" />
        </div>
        <nav className="flex w-full flex-col items-center gap-2 px-2" aria-label="Workstation views">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              title={`${tab.label}: ${tab.description}`}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-md border text-muted-foreground transition-colors",
                activeTab === tab.key
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                  : "border-transparent hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100",
              )}
            >
              {tab.icon}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex h-10 w-10 items-center justify-center rounded-md border border-zinc-800 text-zinc-500">
          <SlidersHorizontal className="h-4 w-4" />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-none items-center justify-between gap-4 border-b border-border/70 bg-zinc-950/35 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <LayoutDashboard className="h-3.5 w-3.5 text-amber-400" />
              Workstation
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-base font-semibold text-foreground">{active.label}</h1>
              <span className="text-xs text-muted-foreground">{active.description}</span>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2 md:hidden">
            {tabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange(tab.key)}
                className={cn(
                  "rounded border px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === tab.key
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                    : "border-zinc-800 text-muted-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="hidden flex-none items-center gap-2 text-xs text-muted-foreground lg:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.75)]" />
            Live same-origin API
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </section>

      <aside className="hidden w-[312px] flex-none border-l border-border/70 bg-zinc-950/45 xl:flex xl:flex-col">
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
          <PanelRight className="h-4 w-4 text-amber-300" />
          <div>
            <div className="text-sm font-semibold text-foreground">Intelligence Layer</div>
            <div className="text-xs text-muted-foreground">Architecture readiness</div>
          </div>
        </div>
        <div className="space-y-1 p-3">
          {readiness.map(item => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-md border border-zinc-800/80 bg-black/20 p-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-zinc-300" />
                  <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                    {item.label}
                  </span>
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-100">{item.value}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-auto border-t border-border/70 p-4 text-xs leading-relaxed text-muted-foreground">
          Phase 5 keeps the live product stable while carving out space for chart, signal inspector,
          options, alert, and AI review panels.
        </div>
      </aside>
    </div>
  );
}
