import type { InstrumentId } from "../core";

export interface Position {
  instrument: InstrumentId;
  quantity: number;
  averagePrice: number;
  marketValue?: number;
}

export interface PortfolioSnapshot {
  id: string;
  ts: number;
  cash: number;
  positions: Position[];
}
