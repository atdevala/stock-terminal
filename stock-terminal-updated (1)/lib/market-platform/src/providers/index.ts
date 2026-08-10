import type { Candle, CorporateEvent, FundamentalsSnapshot, Quote } from "../data";
import type { InstrumentId, Result, Timeframe } from "../core";
import type { OptionsChain } from "../options";

export interface ProviderCapabilityMap {
  quotes: boolean;
  candles: boolean;
  fundamentals: boolean;
  news: boolean;
  options: boolean;
  streaming: boolean;
}

export interface ProviderRequestContext {
  requestId: string;
  timeoutMs?: number;
  priority?: "low" | "normal" | "high";
}

export interface MarketDataProvider {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilityMap;
  normalizeSymbol(instrument: InstrumentId): string;
  getQuote(instrument: InstrumentId, context?: ProviderRequestContext): Promise<Result<Quote>>;
  getCandles(
    instrument: InstrumentId,
    timeframe: Timeframe,
    range: { from: number; to: number },
    context?: ProviderRequestContext,
  ): Promise<Result<Candle[]>>;
  getFundamentals(instrument: InstrumentId, context?: ProviderRequestContext): Promise<Result<FundamentalsSnapshot>>;
  getEvents(instrument: InstrumentId, context?: ProviderRequestContext): Promise<Result<CorporateEvent[]>>;
  getOptionsChain?(instrument: InstrumentId, expiration?: string, context?: ProviderRequestContext): Promise<Result<OptionsChain>>;
}

export interface ProviderRouter {
  primary: string;
  fallbacks: string[];
  route(capability: keyof ProviderCapabilityMap, instrument: InstrumentId): MarketDataProvider[];
}
