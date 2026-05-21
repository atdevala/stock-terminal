export interface LayoutBreakpoint {
  id: "mobile" | "tablet" | "desktop" | "wide";
  minWidth: number;
}

export interface LayoutRegion {
  id: string;
  minSize?: number;
  preferredSize?: number;
  resizable: boolean;
}
