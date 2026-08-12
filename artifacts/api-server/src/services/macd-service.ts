import { finnhubGet } from "../lib/finnhub";
import { getExtendedMetrics, getQuote, appendLivePrice } from "../lib/finnhub";
import { ALL_TICKERS } from "../lib/stocks-data";

export type MacdMarker = "buy" | "sell";

export interface MacdPoint {
  date: string;
  close: number;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  marker?: MacdMarker;
}

export interface MacdResponse {
  ticker: string;
  range: "6M";
  points: MacdPoint[];
  cached: boolean;
  updatedAt: number;
}

export type MacdFailureReason =
  | "INVALID_TICKER"
  | "UNKNOWN_WATCHLIST_TICKER"
  | "NO_CANDLE_DATA"
  | "PROVIDER_ERROR";

export interface MacdFailure {
  ok: false;
  status: number;
  error: string;
  reason: MacdFailureReason;
}

export interface MacdSuccess extends MacdResponse {
  ok: true;
}

export type MacdResult = MacdSuccess | MacdFailure;

const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const WATCHLIST_TICKERS = new Set(ALL_TICKERS);
const macdCache = new Map<string, { response: MacdResponse; ts: number }>();

interface CandleSeries {
  timestamps: number[];
  closes: number[];
}

function normalizeTicker(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isValidTicker(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker);
}

function ema(values: number[], period: number): Array<number | null> {
  const result = new Array<number | null>(values.length).fill(null);
  if (values.length < period) return result;

  const multiplier = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;

  for (let i = period; i < values.length; i++) {
    previous = (values[i]! - previous) * multiplier + previous;
    result[i] = previous;
  }

  return result;
}

function emaFromNullable(values: Array<number | null>, period: number): Array<number | null> {
  const result = new Array<number | null>(values.length).fill(null);
  const first = values.findIndex(value => value !== null);
  if (first < 0) return result;

  const compact = values.slice(first).filter((value): value is number => value !== null);
  const compactEma = ema(compact, period);
  for (let i = 0; i < compactEma.length; i++) {
    result[first + i] = compactEma[i] ?? null;
  }

  return result;
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

function buildMacdPoints(timestamps: number[], closes: number[]): MacdPoint[] {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = closes.map((_, index) =>
    ema12[index] !== null && ema26[index] !== null ? ema12[index]! - ema26[index]! : null,
  );
  const signal = emaFromNullable(macd, 9);

  return closes.map((close, index) => {
    const macdValue = macd[index];
    const signalValue = signal[index];
    const histogram = macdValue !== null && signalValue !== null ? macdValue - signalValue : null;
    const previousMacd = index > 0 ? macd[index - 1] : null;
    const previousSignal = index > 0 ? signal[index - 1] : null;
    const marker =
      previousMacd !== null && previousSignal !== null && macdValue !== null && signalValue !== null
        ? previousMacd <= previousSignal && macdValue > signalValue
          ? "buy"
          : previousMacd >= previousSignal && macdValue < signalValue
            ? "sell"
            : undefined
        : undefined;

    return {
      date: new Date(timestamps[index]! * 1000).toISOString().slice(0, 10),
      close: round(close)!,
      macd: round(macdValue),
      signal: round(signalValue),
      histogram: round(histogram),
      ...(marker ? { marker } : {}),
    };
  });
}

function normalizeCandles(rawTimestamps: number[], rawCloses: number[]): CandleSeries {
  const candles = rawCloses
    .map((close, index) => ({ close, timestamp: rawTimestamps[index] }))
    .filter((item): item is { close: number; timestamp: number } =>
      Number.isFinite(item.close) && Number.isFinite(item.timestamp),
    );

  return {
    closes: candles.map(item => item.close),
    timestamps: candles.map(item => item.timestamp),
  };
}

async function fetchFinnhubCandles(ticker: string): Promise<CandleSeries | null> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 220 * 86400;
  const data = await finnhubGet(`/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}`) as Record<string, unknown>;

  if (data["s"] !== "ok" || !Array.isArray(data["c"]) || !Array.isArray(data["t"])) {
    return null;
  }

  return normalizeCandles(data["t"] as number[], data["c"] as number[]);
}

async function fetchYahooCandles(ticker: string): Promise<CandleSeries | null> {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d`,
    {
      signal: AbortSignal.timeout(10_000),
      // Without a User-Agent, Yahoo silently rejects/blocks requests from
      // cloud-hosted IPs (Render, AWS, GCP, etc.) with no error body.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-terminal/1.0)" },
    },
  );
  if (!response.ok) return null;

  const payload = await response.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  return normalizeCandles(timestamps, closes.map(value => value ?? Number.NaN));
}

function getCachedMetricCandles(ticker: string): CandleSeries | null {
  const storedCloses = getExtendedMetrics(ticker)?.closes60d ?? [];
  if (storedCloses.length < 35) return null;

  // closes60d live-price audit: this fallback (only reached when BOTH live
  // Finnhub and Yahoo candle fetches above have failed) reads our own
  // TTL-refreshed candle cache, which can lag same-day price action the same
  // way RSI did before that fix — MACD is the same "is momentum turning right
  // now" category of indicator, so it gets the same appendLivePrice treatment.
  // The two PRIMARY fetch paths (fetchFinnhubCandles/fetchYahooCandles above)
  // deliberately do NOT get this — they're live network calls returning
  // whatever that provider already considers current, and appending our own
  // quote on top of an already-fresh series risks double-counting today.
  const currentPrice = getQuote(ticker)?.price ?? 0;
  const closes = appendLivePrice(storedCloses, currentPrice);

  const today = Math.floor(Date.now() / 1000);
  return {
    closes,
    timestamps: closes.map((_, index) => today - (closes.length - 1 - index) * 86400),
  };
}

export const macdService = {
  async getMacd(rawTicker: unknown): Promise<MacdResult> {
    const ticker = normalizeTicker(rawTicker);
    if (!isValidTicker(ticker)) {
      return { ok: false, status: 400, error: "Invalid ticker symbol.", reason: "INVALID_TICKER" };
    }

    if (!WATCHLIST_TICKERS.has(ticker)) {
      return {
        ok: false,
        status: 404,
        error: "Ticker is not in the watchlist universe.",
        reason: "UNKNOWN_WATCHLIST_TICKER",
      };
    }

    const cached = macdCache.get(ticker);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { ...cached.response, cached: true, ok: true };
    }

    try {
      const candles = await fetchFinnhubCandles(ticker)
        .catch(() => null)
        ?? await fetchYahooCandles(ticker).catch(() => null)
        ?? getCachedMetricCandles(ticker);
      const closes = candles?.closes ?? [];
      const timestamps = candles?.timestamps ?? [];
      if (closes.length < 35 || timestamps.length < closes.length) {
        return { ok: false, status: 404, error: "Not enough candle data is available for this ticker.", reason: "NO_CANDLE_DATA" };
      }

      const points = buildMacdPoints(timestamps, closes).slice(-130);
      const response: MacdResponse = {
        ticker,
        range: "6M",
        points,
        cached: false,
        updatedAt: Date.now(),
      };
      macdCache.set(ticker, { response, ts: Date.now() });

      return { ...response, ok: true };
    } catch {
      return { ok: false, status: 502, error: "MACD candle provider failed.", reason: "PROVIDER_ERROR" };
    }
  },
};
