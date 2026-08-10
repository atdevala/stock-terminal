export interface WorkspaceLayout {
  id: string;
  name: string;
  version: number;
  panels: WorkspacePanel[];
  hotkeys?: Record<string, string>;
}

export interface WorkspacePanel {
  id: string;
  type: "watchlist" | "scanner" | "chart" | "signal-inspector" | "event-feed" | "options-chain" | "ai-brief" | "risk";
  title: string;
  region: "left" | "center" | "right" | "bottom" | "floating";
  state?: Record<string, unknown>;
}

export interface WorkspaceStore {
  load(id: string): Promise<WorkspaceLayout | null>;
  save(layout: WorkspaceLayout): Promise<void>;
  list(): Promise<WorkspaceLayout[]>;
}
