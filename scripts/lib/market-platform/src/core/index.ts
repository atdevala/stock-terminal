export type AssetClass =
  | "equity"
  | "etf"
  | "crypto"
  | "option"
  | "future"
  | "forex"
  | "macro"
  | "news";

export type MarketSession = "pre" | "regular" | "post" | "closed";
export type Timeframe = "tick" | "1m" | "5m" | "15m" | "1h" | "1d" | "1w" | "1mo";

export interface InstrumentId {
  symbol: string;
  assetClass: AssetClass;
  exchange?: string;
  currency?: string;
  providerSymbol?: string;
}

export interface Timestamped {
  ts: number;
}

export interface NumericRange {
  low: number;
  high: number;
}

export interface PlatformError {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
  cause?: unknown;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: PlatformError };
