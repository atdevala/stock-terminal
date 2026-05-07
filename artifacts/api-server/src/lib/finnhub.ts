import WebSocket from "ws";
import { logger } from "./logger";
import { ALL_TICKERS, TICKER_TO_COMPANY } from "./stocks-data";

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

export interface MarketStatusData {
  isOpen: boolean;
  exchange: string;
  timezone: string;
  session: string;
}

// In-memory state
const quoteCache = new Map<string, QuoteData>();
let wsConnected = false;
let marketStatus: MarketStatusData = {
  isOpen: false,
  exchange: "US",
  timezone: "America/New_York",
  session: "closed",
};

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

async function finnhubGet(path: string): Promise<unknown> {
  const url = `https://finnhub.io/api/v1${path}&token=${FINNHUB_KEY}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`Finnhub ${path} → ${resp.status}`);
  return resp.json();
}

async function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

/** Fetch REST quote for a single ticker */
async function fetchQuoteRest(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/quote?symbol=${ticker}`) as Record<string, number>;
    if (!data.c) return;
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

/** Fetch 52W high/low and PE from basic-financials */
async function fetchFundamentals(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/stock/metric?symbol=${ticker}&metric=all`) as Record<string, unknown>;
    const m = (data["metric"] ?? {}) as Record<string, number | null>;
    const existing = quoteCache.get(ticker);
    if (existing) {
      quoteCache.set(ticker, {
        ...existing,
        high52: m["52WeekHigh"]              ?? existing.high52,
        low52:  m["52WeekLow"]               ?? existing.low52,
        pe:     m["peBasicExclExtraTTM"]     ?? m["peTTM"] ?? existing.pe,
      });
    }
  } catch (err) {
    logger.warn({ ticker, err }, "Fundamentals fetch failed");
  }
}

/** Fetch market cap + volume from stock profile + quote */
async function fetchProfile(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/stock/profile2?symbol=${ticker}`) as Record<string, unknown>;
    const mcapMillions = data["marketCapitalization"] as number | null;
    const existing = quoteCache.get(ticker);
    if (existing && mcapMillions) {
      quoteCache.set(ticker, {
        ...existing,
        marketCap: fmtMcap(mcapMillions * 1e6),
      });
    }
  } catch (err) {
    logger.warn({ ticker, err }, "Profile fetch failed");
  }
}

/** Batch-fetch all REST quotes (handles rate limit: max 60/min free tier) */
async function loadInitialData(): Promise<void> {
  if (!FINNHUB_KEY) {
    logger.warn("FINNHUB_API_KEY not set — live prices unavailable");
    return;
  }

  logger.info("Fetching initial quotes for all tickers...");
  // Phase 1: quotes — 30 tickers, 100ms between each ≈ 3s
  for (const ticker of ALL_TICKERS) {
    await fetchQuoteRest(ticker);
    await sleep(100);
  }
  logger.info(`  ✓ Quotes loaded: ${quoteCache.size}/${ALL_TICKERS.length}`);

  // Phase 2: fundamentals (52W hi/lo, PE) — run in background, 200ms between each
  void (async () => {
    for (const ticker of ALL_TICKERS) {
      await fetchFundamentals(ticker);
      await sleep(200);
    }
    logger.info("  ✓ Fundamentals loaded");
  })();

  // Phase 3: market cap from profiles — run in background after fundamentals settle
  void (async () => {
    await sleep(8000);
    for (const ticker of ALL_TICKERS) {
      await fetchProfile(ticker);
      await sleep(200);
    }
    logger.info("  ✓ Profiles loaded");
  })();
}

/** Refresh market status every 30 seconds */
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
  } catch {
    // keep previous value
  }
}

/** Refresh all quotes every 30 seconds as a REST fallback (WebSocket is primary) */
async function periodicRestRefresh(): Promise<void> {
  while (true) {
    await sleep(30_000);
    for (const ticker of ALL_TICKERS) {
      await fetchQuoteRest(ticker);
      await sleep(150);
    }
  }
}

/** Connect to Finnhub WebSocket for real-time trade events */
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
          change:        change,
          changePercent: changePct,
          high:          Math.max(existing.high || newPrice, newPrice),
          low:           existing.low > 0 ? Math.min(existing.low, newPrice) : newPrice,
          volume:        fmtVol(trade.v),
          lastUpdated:   trade.t,
        });
      }
    } catch {
      // ignore parse errors
    }
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

/** Exported API */
export function getAllQuotes(): QuoteData[] {
  return ALL_TICKERS.map(t => quoteCache.get(t)).filter(Boolean) as QuoteData[];
}

export function getMarketStatus(): MarketStatusData {
  return marketStatus;
}

export function isWsConnected(): boolean {
  return wsConnected;
}

/** Call once at server startup */
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
}
