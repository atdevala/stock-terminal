import type { InstrumentId, Timeframe } from "../core";

export interface ChartViewport {
  instrument: InstrumentId;
  timeframe: Timeframe;
  from: number;
  to: number;
}

export interface ChartOverlay {
  id: string;
  type: "indicator" | "signal" | "drawing" | "event";
  visible: boolean;
  options?: Record<string, unknown>;
}

export interface ChartLayout {
  id: string;
  viewport: ChartViewport;
  overlays: ChartOverlay[];
}
