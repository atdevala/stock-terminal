import WebSocket from "ws";
import { logger } from "./logger";
import { ALL_TICKERS } from "./stocks-data";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? "";

export interface QuoteData {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  prevClose: number;
  high: number;
  low: number;
  open: number;
  high52?: number;
  low52?: number;
  marketCap?: string;
  volume?: string;
  pe?: number;
  lastUpdated: number;
}

export interface ExtendedMetrics {
  ticker: string;
  revenueGrowthYoy?: number;
  revenueGrowthQoQ?: number;
  grossMargin?: number;
  operatingMargin?: number;
  fcfMargin?: number;
  debtToEquity?: number;
  pe?: number;
  evSales?: number;
  ma50?: number;
  ma200?: number;
  earningsRevisionsUp?: boolean;
}

export interface MarketStatusData {
  isOpen: boolean;
  exchange: string;
  timezone: string;
  session: string;
}

// In-memory state
const quoteCache = new Map<string, QuoteData>();
const extMetricsCache = new Map<string, ExtendedMetrics>();
let wsConnected = false;
let marketStatus: MarketStatusData = {
  isOpen: false,
  exchange: "US",
  timezone: "America/New_York",
  session: "closed",
};

// ── Rate-limit queue ──────────────────────────────────────────────────────────
// Finnhub free tier: 60 calls/minute. We target 40/min (one per 1500ms) to stay
// safely under the limit even when multiple phases are running.
const RATE_INTERVAL_MS = 1500;
const pendingQueue: Array<() => void> = [];
let queueProcessing = false;
let lastCallTime = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pendingQueue.push(async () => {
      try { resolve(await fn()); } catch (e) { reject(e); }
    });
    if (!queueProcessing) void processQueue();
  });
}

async function processQueue(): Promise<void> {
  queueProcessing = true;
  while (pendingQueue.length > 0) {
    const now = Date.now();
    const wait = RATE_INTERVAL_MS - (now - lastCallTime);
    if (wait > 0) await sleep(wait);
    const task = pendingQueue.shift();
    lastCallTime = Date.now();
    if (task) await task();
  }
  queueProcessing = false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMcap(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function fmtVol(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

async function sleep(ms: number): Promise<void> {
  return new Promise<void>(r => setTimeout(r, ms));
}

function n(v: number | null | undefined): number | undefined {
  return (v === null || v === undefined || isNaN(v as number)) ? undefined : (v as number);
}

// ── Rate-limited Finnhub fetch with 429 retry ─────────────────────────────────
async function finnhubGet(path: string): Promise<unknown> {
  return enqueue(async () => {
    const url = `https://finnhub.io/api/v1${path}&token=${FINNHUB_KEY}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (resp.status === 429) {
        const backoff = Math.pow(2, attempt) * 5_000; // 5s, 10s, 20s, 40s
        logger.warn({ path, attempt: attempt + 1, backoff }, "Rate limited (429) — backing off");
        await sleep(backoff);
        continue;
      }
      if (!resp.ok) throw new Error(`Finnhub ${path} → ${resp.status}`);
      return resp.json();
    }
    throw new Error(`Finnhub ${path} → 429 after 4 retries`);
  });
}

// ── Per-ticker fetch functions ────────────────────────────────────────────────

async function fetchQuoteRest(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/quote?symbol=${ticker}`) as Record<string, number>;
    if (!data["c"]) return;
    const existing = quoteCache.get(ticker);
    quoteCache.set(ticker, {
      ticker,
      price:         data["c"]  ?? existing?.price ?? 0,
      change:        data["d"]  ?? 0,
      changePercent: data["dp"] ?? 0,
      prevClose:     data["pc"] ?? 0,
      high:          data["h"]  ?? 0,
      low:           data["l"]  ?? 0,
      open:          data["o"]  ?? 0,
      high52:        existing?.high52,
      low52:         existing?.low52,
      marketCap:     existing?.marketCap,
      volume:        existing?.volume,
      pe:            existing?.pe,
      lastUpdated:   Date.now(),
    });
  } catch (err) {
    logger.warn({ ticker, err }, "REST quote fetch failed");
  }
}

async function fetchFundamentals(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/stock/metric?symbol=${ticker}&metric=all`) as Record<string, unknown>;
    const m = (data["metric"] ?? {}) as Record<string, number | null>;

    const existing = quoteCache.get(ticker);
    if (existing) {
      quoteCache.set(ticker, {
        ...existing,
        high52: n(m["52WeekHigh"])          ?? existing.high52,
        low52:  n(m["52WeekLow"])           ?? existing.low52,
        pe:     n(m["peBasicExclExtraTTM"]) ?? n(m["peTTM"]) ?? existing.pe,
      });
    }

    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, {
      ...ext,
      ticker,
      revenueGrowthYoy: n(m["revenueGrowthTTMYoy"]),
      revenueGrowthQoQ: n(m["revenueGrowthQuarterlyYoy"]),
      grossMargin:      n(m["grossMarginTTM"]),
      operatingMargin:  n(m["operatingMarginTTM"]),
      fcfMargin:        n(m["fcfMarginTTM"]),
      debtToEquity:     n(m["debtEquityQuarterly"]),
      pe:               n(m["peBasicExclExtraTTM"]) ?? n(m["peTTM"]),
      evSales:          n(m["evSalesTTM"]),
    });
  } catch (err) {
    logger.warn({ ticker, err }, "Fundamentals fetch failed");
  }
}

async function fetchProfile(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/stock/profile2?symbol=${ticker}`) as Record<string, unknown>;
    const mcapMillions = data["marketCapitalization"] as number | null;
    const existing = quoteCache.get(ticker);
    if (existing && mcapMillions) {
      quoteCache.set(ticker, { ...existing, marketCap: fmtMcap(mcapMillions * 1e6) });
    }
  } catch (err) {
    logger.warn({ ticker, err }, "Profile fetch failed");
  }
}

async function fetchCandlesAndMAs(ticker: string): Promise<void> {
  try {
    const to   = Math.floor(Date.now() / 1000);
    const from = to - 220 * 86400;
    const data = await finnhubGet(
      `/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}`
    ) as Record<string, unknown>;

    if (data["s"] !== "ok") return;
    const closes = data["c"] as number[];
    if (!closes || closes.length < 10) return;

    const ma50  = closes.length >= 50
      ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
      : closes.reduce((a, b) => a + b, 0) / closes.length;

    const ma200 = closes.length >= 200
      ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      : closes.reduce((a, b) => a + b, 0) / closes.length;

    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, ma50, ma200 });
  } catch (err) {
    logger.warn({ ticker, err }, "Candles/MA fetch failed");
  }
}

async function fetchRecommendations(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/stock/recommendation?symbol=${ticker}`) as Array<Record<string, number>>;
    if (!Array.isArray(data) || data.length === 0) return;

    const latest = data[0]!;
    const bullish = (latest["buy"] ?? 0) + (latest["strongBuy"] ?? 0);
    const bearish = (latest["sell"] ?? 0) + (latest["strongSell"] ?? 0);

    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, earningsRevisionsUp: bullish >= bearish });
  } catch (err) {
    logger.warn({ ticker, err }, "Recommendations fetch failed");
  }
}

// ── Sequential startup phases ─────────────────────────────────────────────────
// All phases run one after the other — no concurrent bursts.
// All calls go through the rate-limit queue so 429s can't accumulate.

async function loadInitialData(): Promise<void> {
  if (!FINNHUB_KEY) {
    logger.warn("FINNHUB_API_KEY not set — live prices unavailable");
    return;
  }

  // Phase 1: REST quotes
  logger.info("Phase 1: Fetching quotes...");
  for (const ticker of ALL_TICKERS) {
    await fetchQuoteRest(ticker);
  }
  logger.info(`  ✓ Quotes loaded: ${quoteCache.size}/${ALL_TICKERS.length}`);

  // Phase 2: Fundamentals (52W H/L, PE, margins, etc.)
  logger.info("Phase 2: Fetching fundamentals...");
  for (const ticker of ALL_TICKERS) {
    await fetchFundamentals(ticker);
  }
  logger.info("  ✓ Fundamentals loaded");

  // Phase 3: Market cap profiles
  logger.info("Phase 3: Fetching profiles...");
  for (const ticker of ALL_TICKERS) {
    await fetchProfile(ticker);
  }
  logger.info("  ✓ Profiles loaded");

  // Phase 4: Candles for 50/200-day MAs
  logger.info("Phase 4: Fetching candles/MAs...");
  for (const ticker of ALL_TICKERS) {
    await fetchCandlesAndMAs(ticker);
  }
  logger.info("  ✓ Moving averages loaded");

  // Phase 5: Analyst recommendations
  logger.info("Phase 5: Fetching recommendations...");
  for (const ticker of ALL_TICKERS) {
    await fetchRecommendations(ticker);
  }
  logger.info("  ✓ Recommendations loaded");
}

// ── Market status ─────────────────────────────────────────────────────────────

async function refreshMarketStatus(): Promise<void> {
  if (!FINNHUB_KEY) return;
  try {
    const data = await finnhubGet("/stock/market-status?exchange=US") as Record<string, unknown>;
    marketStatus = {
      isOpen:   Boolean(data["isOpen"]),
      exchange: String(data["exchange"] ?? "US"),
      timezone: String(data["timezone"] ?? "America/New_York"),
      session:  String(data["session"]  ?? (data["isOpen"] ? "regular" : "closed")),
    };
  } catch { /* keep previous value */ }
}

// ── Periodic refreshes ────────────────────────────────────────────────────────

async function periodicRestRefresh(): Promise<void> {
  while (true) {
    // WebSocket handles real-time; this is a 60s safety-net fallback
    await sleep(60_000);
    for (const ticker of ALL_TICKERS) {
      await fetchQuoteRest(ticker);
    }
  }
}

async function periodicMetricsRefresh(): Promise<void> {
  while (true) {
    await sleep(6 * 60 * 60 * 1000);
    for (const ticker of ALL_TICKERS) {
      await fetchFundamentals(ticker);
    }
    for (const ticker of ALL_TICKERS) {
      await fetchCandlesAndMAs(ticker);
    }
    for (const ticker of ALL_TICKERS) {
      await fetchRecommendations(ticker);
    }
    logger.info("  ✓ Periodic metrics refresh complete");
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWebSocket(): void {
  if (!FINNHUB_KEY) return;

  const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);

  ws.on("open", () => {
    wsConnected = true;
    logger.info("Finnhub WebSocket connected — subscribing to all tickers");
    for (const ticker of ALL_TICKERS) {
      ws.send(JSON.stringify({ type: "subscribe", symbol: ticker }));
    }
  });

  ws.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (msg["type"] !== "trade") return;
      const trades = msg["data"] as Array<{ s: string; p: number; t: number; v: number }>;
      if (!Array.isArray(trades)) return;

      for (const trade of trades) {
        const ticker = trade.s;
        const existing = quoteCache.get(ticker);
        if (!existing) continue;
        const newPrice = trade.p;
        const change   = newPrice - existing.prevClose;
        const changePct = existing.prevClose > 0
          ? (change / existing.prevClose) * 100
          : existing.changePercent;

        quoteCache.set(ticker, {
          ...existing,
          price:         newPrice,
          change,
          changePercent: changePct,
          high:          Math.max(existing.high || newPrice, newPrice),
          low:           existing.low > 0 ? Math.min(existing.low, newPrice) : newPrice,
          volume:        fmtVol(trade.v),
          lastUpdated:   trade.t,
        });
      }
    } catch { /* ignore parse errors */ }
  });

  ws.on("close", () => {
    wsConnected = false;
    logger.warn("Finnhub WebSocket closed — reconnecting in 5s");
    setTimeout(connectWebSocket, 5000);
  });

  ws.on("error", (err: Error) => {
    logger.warn({ err: err.message }, "Finnhub WebSocket error");
    wsConnected = false;
  });
}

// ── Exported API ──────────────────────────────────────────────────────────────

export function getAllQuotes(): QuoteData[] {
  return ALL_TICKERS.map(t => quoteCache.get(t)).filter(Boolean) as QuoteData[];
}

export function getMarketStatus(): MarketStatusData {
  return marketStatus;
}

export function isWsConnected(): boolean {
  return wsConnected;
}

export function getExtendedMetrics(ticker: string): ExtendedMetrics | undefined {
  return extMetricsCache.get(ticker);
}

export function getAllExtendedMetrics(): ExtendedMetrics[] {
  return ALL_TICKERS.map(t => extMetricsCache.get(t)).filter(Boolean) as ExtendedMetrics[];
}

export function getCurrentPrice(ticker: string): number {
  return quoteCache.get(ticker)?.price ?? 0;
}

export async function startFinnhubService(): Promise<void> {
  if (!FINNHUB_KEY) {
    logger.warn("FINNHUB_API_KEY missing — set it to enable live prices");
    return;
  }
  await loadInitialData();
  connectWebSocket();
  void refreshMarketStatus();
  setInterval(() => void refreshMarketStatus(), 30_000);
  void periodicRestRefresh();
  void periodicMetricsRefresh();
}
