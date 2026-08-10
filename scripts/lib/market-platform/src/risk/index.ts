import type { PortfolioSnapshot } from "../portfolio";

export interface RiskLimit {
  id: string;
  metric: "position-size" | "sector-exposure" | "drawdown" | "var" | "options-gamma";
  threshold: number;
}

export interface RiskReport {
  portfolio: PortfolioSnapshot;
  ts: number;
  breaches: Array<{ limit: RiskLimit; observed: number; message: string }>;
  notes: string[];
}
