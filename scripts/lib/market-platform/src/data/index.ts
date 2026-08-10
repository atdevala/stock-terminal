import type { InstrumentId, MarketSession, Timeframe, Timestamped } from "../core";

export interface Quote extends Timestamped {
  instrument: InstrumentId;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  session: MarketSession;
  bid?: number;
  ask?: number;
  volume?: number;
}

export interface Candle extends Timestamped {
  instrument: InstrumentId;
  timeframe: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface FundamentalsSnapshot extends Timestamped {
  instrument: InstrumentId;
  revenueGrowthYoy?: number;
  revenueGrowthQoq?: number;
  grossMargin?: number;
  operatingMargin?: number;
  freeCashFlowMargin?: number;
  debtToEquity?: number;
  peRatio?: number;
  evToSales?: number;
  marketCap?: number;
}

export interface CorporateEvent extends Timestamped {
  instrument: InstrumentId;
  type: "earnings" | "dividend" | "split" | "analyst-rating" | "insider-trade" | "news";
  headline: string;
  source?: string;
  url?: string;
  payload?: Record<string, unknown>;
}

export interface MarketDataSnapshot {
  quote?: Quote;
  candles?: Candle[];
  fundamentals?: FundamentalsSnapshot;
  events?: CorporateEvent[];
}
