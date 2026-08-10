import type { InstrumentId } from "../core";

export interface BacktestRequest {
  strategyId: string;
  universe: InstrumentId[];
  from: number;
  to: number;
  initialCapital: number;
}

export interface BacktestResult {
  request: BacktestRequest;
  totalReturn: number;
  maxDrawdown: number;
  sharpe?: number;
  trades: Array<{ instrument: InstrumentId; entryTs: number; exitTs?: number; pnl: number }>;
}
