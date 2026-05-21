import type {
  Candle,
  CorporateEvent,
  FundamentalsSnapshot,
  MarketDataProvider,
  PlatformError,
  Quote,
  Result,
  Timeframe,
} from "@workspace/market-platform";
import {
  getAllExtendedMetrics,
  getAllQuotes,
  getExtendedMetrics,
  getMarketRegime,
  getMarketStatus,
  getQuote,
  isWsConnected,
  type ExtendedMetrics,
  type MarketStatusData,
  type QuoteData,
} from "../lib/finnhub";
import { toFundamentalsSnapshot, toInstrumentId, toPlatformQuote } from "./normalizers";

export interface QuotesResponse {
  quotes: QuoteData[];
  connected: boolean;
  lastRefreshed: number;
}

export interface TopMoversResponse {
  gainers: Array<{ ticker: string; company: string; price: number; changePercent: number }>;
  losers: Array<{ ticker: string; company: string; price: number; changePercent: number }>;
}

export const marketDataProvider: MarketDataProvider = {
  id: "finnhub",
  displayName: "Finnhub",
  capabilities: {
    quotes: true,
    candles: true,
    fundamentals: true,
    news: false,
    options: false,
    streaming: true,
  },
  normalizeSymbol: instrument => instrument.providerSymbol ?? instrument.symbol,
  async getQuote(instrument): Promise<Result<Quote>> {
    const quote = getQuote(instrument.symbol);
    if (!quote) return providerError("QUOTE_NOT_FOUND", `No quote is loaded for ${instrument.symbol}`);
    return { ok: true, value: toPlatformQuote(quote) };
  },
  async getCandles(_instrument, _timeframe: Timeframe, _range): Promise<Result<Candle[]>> {
    return providerError("CANDLES_ADAPTER_PENDING", "Candles are still served through legacy metrics in Phase 2");
  },
  async getFundamentals(instrument): Promise<Result<FundamentalsSnapshot>> {
    const metrics = getExtendedMetrics(instrument.symbol);
    if (!metrics) return providerError("FUNDAMENTALS_NOT_FOUND", `No fundamentals are loaded for ${instrument.symbol}`);
    return { ok: true, value: toFundamentalsSnapshot(metrics) };
  },
  async getEvents(): Promise<Result<CorporateEvent[]>> {
    return { ok: true, value: [] };
  },
};

export const marketDataService = {
  provider: marketDataProvider,
  getQuotesResponse(): QuotesResponse {
    return {
      quotes: getAllQuotes(),
      connected: isWsConnected(),
      lastRefreshed: Date.now(),
    };
  },
  getAllQuotes(): QuoteData[] {
    return getAllQuotes();
  },
  getQuote(ticker: string): QuoteData | undefined {
    return getQuote(ticker);
  },
  getAllExtendedMetrics(): ExtendedMetrics[] {
    return getAllExtendedMetrics();
  },
  getMarketStatus(): MarketStatusData {
    return getMarketStatus();
  },
  getMarketStatusResponse(): MarketStatusData {
    const s = getMarketStatus();
    return { isOpen: s.isOpen, exchange: s.exchange, timezone: s.timezone, session: s.session };
  },
  getMarketRegime() {
    return getMarketRegime();
  },
  getTopMovers(): TopMoversResponse {
    const quotes = getAllQuotes().filter(q => q.price > 0);
    const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
    return {
      gainers: sorted.slice(0, 5).map(q => ({
        ticker: q.ticker,
        company: q.ticker,
        price: q.price,
        changePercent: q.changePercent,
      })),
      losers: sorted.slice(-5).reverse().map(q => ({
        ticker: q.ticker,
        company: q.ticker,
        price: q.price,
        changePercent: q.changePercent,
      })),
    };
  },
  toInstrumentId,
  toPlatformQuote,
  toFundamentalsSnapshot,
};

function providerError<T = never>(code: string, message: string): Result<T> {
  const error: PlatformError = {
    code,
    message,
    retryable: false,
    provider: "finnhub",
  };
  return { ok: false, error };
}
