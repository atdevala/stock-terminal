import WebSocket from "ws";
import { logger } from "./logger";
import { ALL_TICKERS } from "./stocks-data";
import {
  loadExtCache,
  getCachedFundamentals, setCachedFundamentals,
  getCachedProfile,      setCachedProfile,
  getCachedCandles,      setCachedCandles,
  getCachedRecs,         setCachedRecs,
  getCachedEarnings,     setCachedEarnings,
  getCachedSpy,          setCachedSpy,
  getCachedFundamentalsRaw,
  getCachedCandlesRaw,
  getCachedRecsRaw,
  getCachedEarningsRaw,
  getCachedSpyRaw,
  type FundamentalsPayload,
  type CandlesPayload,
} from "./ext-cache";

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
  closes60d?: number[];
  volumes60d?: number[];
  epsSurprises?: number[];
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
let spyCloses60d: number[] = [];
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
  const cached = getCachedFundamentals(ticker);
  if (cached) {
    const existing = quoteCache.get(ticker);
    if (existing) {
      quoteCache.set(ticker, {
        ...existing,
        high52: cached.high52 ?? existing.high52,
        low52:  cached.low52  ?? existing.low52,
        pe:     cached.pe     ?? existing.pe,
      });
    }
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, {
      ...ext, ticker,
      revenueGrowthYoy: cached.revenueGrowthYoy,
      revenueGrowthQoQ: cached.revenueGrowthQoQ,
      grossMargin:      cached.grossMargin,
      operatingMargin:  cached.operatingMargin,
      fcfMargin:        cached.fcfMargin,
      debtToEquity:     cached.debtToEquity,
      pe:               cached.pe,
      evSales:          cached.evSales,
    });
    return;
  }
  try {
    const data = await finnhubGet(`/stock/metric?symbol=${ticker}&metric=all`) as Record<string, unknown>;
    const m = (data["metric"] ?? {}) as Record<string, number | null>;
    const payload: FundamentalsPayload = {
      high52:           n(m["52WeekHigh"]),
      low52:            n(m["52WeekLow"]),
      pe:               n(m["peBasicExclExtraTTM"]) ?? n(m["peTTM"]),
      revenueGrowthYoy: n(m["revenueGrowthTTMYoy"]),
      revenueGrowthQoQ: n(m["revenueGrowthQuarterlyYoy"]),
      grossMargin:      n(m["grossMarginTTM"]),
      operatingMargin:  n(m["operatingMarginTTM"]),
      fcfMargin:        n(m["fcfMarginTTM"]),
      debtToEquity:     n(m["debtEquityQuarterly"]),
      evSales:          n(m["evSalesTTM"]),
    };
    setCachedFundamentals(ticker, payload);
    const existing = quoteCache.get(ticker);
    if (existing) {
      quoteCache.set(ticker, {
        ...existing,
        high52: payload.high52 ?? existing.high52,
        low52:  payload.low52  ?? existing.low52,
        pe:     payload.pe     ?? existing.pe,
      });
    }
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, {
      ...ext, ticker,
      revenueGrowthYoy: payload.revenueGrowthYoy,
      revenueGrowthQoQ: payload.revenueGrowthQoQ,
      grossMargin:      payload.grossMargin,
      operatingMargin:  payload.operatingMargin,
      fcfMargin:        payload.fcfMargin,
      debtToEquity:     payload.debtToEquity,
      pe:               payload.pe,
      evSales:          payload.evSales,
    });
  } catch (err) {
    logger.warn({ ticker, err }, "Fundamentals fetch failed");
  }
}

async function fetchProfile(ticker: string): Promise<void> {
  const cached = getCachedProfile(ticker);
  if (cached) {
    const existing = quoteCache.get(ticker);
    if (existing && cached.marketCapMillions) {
      quoteCache.set(ticker, { ...existing, marketCap: fmtMcap(cached.marketCapMillions * 1e6) });
    }
    return;
  }
  try {
    const data = await finnhubGet(`/stock/profile2?symbol=${ticker}`) as Record<string, unknown>;
    const mcapMillions = data["marketCapitalization"] as number | null | undefined;
    const existing = quoteCache.get(ticker);
    if (existing && mcapMillions) {
      quoteCache.set(ticker, { ...existing, marketCap: fmtMcap(mcapMillions * 1e6) });
    }
    setCachedProfile(ticker, { marketCapMillions: mcapMillions ?? undefined });
  } catch (err) {
    logger.warn({ ticker, err }, "Profile fetch failed");
  }
}

// Finnhub's free tier does not include /stock/candle for US equities (it
// returns a 403/no_data response) — this was discovered empirically after
// the RSI/MACD/ACS candle-mode features all came back permanently empty in
// production, not just during the cold-start window. Yahoo's public chart
// endpoint is the fallback, same as macd-service.ts already used for MACD;
// a User-Agent header is required or Yahoo silently rejects/blocks requests
// from cloud-hosted IPs (Render, AWS, GCP, etc.) with no body.
async function fetchYahooDailyCandles(ticker: string): Promise<{ closes: number[]; volumes: number[] } | null> {
  try {
    const resp = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`,
      {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-terminal/1.0)" },
      },
    );
    if (!resp.ok) return null;
    const payload = await resp.json() as {
      chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> } }> };
    };
    const quote = payload.chart?.result?.[0]?.indicators?.quote?.[0];
    const closes = (quote?.close ?? []).filter((v): v is number => typeof v === "number");
    const volumes = (quote?.volume ?? []).filter((v): v is number => typeof v === "number");
    if (closes.length < 10) return null;
    return { closes, volumes };
  } catch (err) {
    logger.warn({ ticker, err }, "Yahoo candles fallback failed");
    return null;
  }
}

async function fetchCandlesAndMAs(ticker: string): Promise<void> {
  const cached = getCachedCandles(ticker);
  if (cached) {
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, {
      ...ext, ticker,
      ma50:      cached.ma50,
      ma200:     cached.ma200,
      closes60d: cached.closes60d,
      volumes60d: cached.volumes60d,
    });
    return;
  }

  let closes: number[] | undefined;
  let volumes: number[] | undefined;

  try {
    const to   = Math.floor(Date.now() / 1000);
    const from = to - 220 * 86400;
    const data = await finnhubGet(
      `/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}`
    ) as Record<string, unknown>;

    if (data["s"] === "ok" && Array.isArray(data["c"]) && (data["c"] as number[]).length >= 10) {
      closes  = data["c"] as number[];
      volumes = data["v"] as number[] | undefined;
    }
  } catch (err) {
    logger.warn({ ticker, err }, "Finnhub candles fetch failed — trying Yahoo fallback");
  }

  if (!closes) {
    const yahoo = await fetchYahooDailyCandles(ticker);
    if (yahoo) {
      closes = yahoo.closes;
      volumes = yahoo.volumes;
    }
  }

  if (!closes || closes.length < 10) return;

  const ma50  = closes.length >= 50
    ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50
    : closes.reduce((a, b) => a + b, 0) / closes.length;

  const ma200 = closes.length >= 200
    ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
    : closes.reduce((a, b) => a + b, 0) / closes.length;

  const payload: CandlesPayload = {
    ma50,
    ma200,
    closes60d:  closes.slice(-60),
    volumes60d: volumes ? volumes.slice(-60) : undefined,
  };
  setCachedCandles(ticker, payload);

  const ext = extMetricsCache.get(ticker) ?? { ticker };
  extMetricsCache.set(ticker, {
    ...ext, ticker,
    ma50:      payload.ma50,
    ma200:     payload.ma200,
    closes60d: payload.closes60d,
    volumes60d: payload.volumes60d ?? ext.volumes60d,
  });
}

async function fetchRecommendations(ticker: string): Promise<void> {
  const cached = getCachedRecs(ticker);
  if (cached) {
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, earningsRevisionsUp: cached.earningsRevisionsUp });
    return;
  }
  try {
    const data = await finnhubGet(`/stock/recommendation?symbol=${ticker}`) as Array<Record<string, number>>;
    if (!Array.isArray(data) || data.length === 0) return;

    const latest = data[0]!;
    const bullish = (latest["buy"] ?? 0) + (latest["strongBuy"] ?? 0);
    const bearish = (latest["sell"] ?? 0) + (latest["strongSell"] ?? 0);
    const earningsRevisionsUp = bullish >= bearish;
    setCachedRecs(ticker, { earningsRevisionsUp });

    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, earningsRevisionsUp });
  } catch (err) {
    logger.warn({ ticker, err }, "Recommendations fetch failed");
  }
}

/** Fetch last 4 quarters of EPS surprises for INS earnings slope component */
async function fetchEarnings(ticker: string): Promise<void> {
  const cached = getCachedEarnings(ticker);
  if (cached) {
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, epsSurprises: cached.epsSurprises });
    return;
  }
  try {
    const data = await finnhubGet(`/stock/earnings?symbol=${ticker}&limit=4`) as Array<Record<string, unknown>>;
    if (!Array.isArray(data) || data.length === 0) return;

    const surprises = data
      .filter(e => e["actual"] != null && e["estimate"] != null && (e["estimate"] as number) !== 0)
      .map(e => ((e["actual"] as number) - (e["estimate"] as number)) / Math.abs(e["estimate"] as number) * 100)
      .slice(0, 4);
    setCachedEarnings(ticker, { epsSurprises: surprises });

    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, epsSurprises: surprises });
  } catch (err) {
    logger.warn({ ticker, err }, "Earnings fetch failed");
  }
}

/** Fetch SPY daily candles for 60-day relative strength calculations */
async function fetchSpyCandles(): Promise<void> {
  const cached = getCachedSpy();
  if (cached) {
    spyCloses60d = cached.closes60d;
    logger.info("  ✓ SPY candles (from cache)");
    return;
  }
  try {
    const to   = Math.floor(Date.now() / 1000);
    const from = to - 90 * 86400;
    const data = await finnhubGet(
      `/stock/candle?symbol=SPY&resolution=D&from=${from}&to=${to}`
    ) as Record<string, unknown>;
    if (data["s"] !== "ok") return;
    const closes = data["c"] as number[];
    if (closes && closes.length > 0) {
      spyCloses60d = closes.slice(-60);
      setCachedSpy({ closes60d: spyCloses60d });
    }
    logger.info("  ✓ SPY candles loaded");
  } catch (err) {
    logger.warn({ err }, "SPY candles fetch failed");
  }
}

// ── Instant prewarm from on-disk ext-cache ────────────────────────────────────
// Called synchronously right after loadExtCache() so that /api/scores can serve
// results immediately on boot, before the 7-phase async refresh completes.

function prewarmExtMetricsCache(): void {
  let count = 0;
  for (const ticker of ALL_TICKERS) {
    // Use raw (TTL-bypassing) getters — stale fundamentals beat empty scores.
    // Phases 1-7 will refresh everything in the background.
    const fundamentals = getCachedFundamentalsRaw(ticker);
    const candles      = getCachedCandlesRaw(ticker);
    const recs         = getCachedRecsRaw(ticker);
    const earnings     = getCachedEarningsRaw(ticker);

    if (!fundamentals && !candles && !recs && !earnings) continue;

    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, {
      ...ext,
      ticker,
      ...(fundamentals ? {
        revenueGrowthYoy: fundamentals.revenueGrowthYoy,
        revenueGrowthQoQ: fundamentals.revenueGrowthQoQ,
        grossMargin:      fundamentals.grossMargin,
        operatingMargin:  fundamentals.operatingMargin,
        fcfMargin:        fundamentals.fcfMargin,
        debtToEquity:     fundamentals.debtToEquity,
        pe:               fundamentals.pe,
        evSales:          fundamentals.evSales,
      } : {}),
      ...(candles ? {
        ma50:       candles.ma50,
        ma200:      candles.ma200,
        closes60d:  candles.closes60d,
        volumes60d: candles.volumes60d,
      } : {}),
      ...(recs    ? { earningsRevisionsUp: recs.earningsRevisionsUp }  : {}),
      ...(earnings? { epsSurprises:        earnings.epsSurprises }     : {}),
    });
    count++;
  }

  // Also prewarm SPY closes so market-regime and INS relative-strength work immediately
  const spy = getCachedSpyRaw();
  if (spy) spyCloses60d = spy.closes60d;

  logger.info(`Ext-cache prewarm complete — ${count} tickers ready for scoring`);
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

  // Phase 2: Candles for 50/200-day MAs + closes60d (RSI, MACD, ACS, INS relative
  // strength all depend on this). Moved to run right after quotes — it used to be
  // Phase 4, which meant closes60d didn't exist for ANY ticker until ~11-15 minutes
  // into every cold start (3 full 150-ticker phases ahead of it at the shared
  // 1.5s/call rate limit). Every score in the "RSI 50 for the whole universe"
  // report was really "RSI unknown for the whole universe, because candles hadn't
  // loaded yet" — running this phase second instead of fourth roughly halves that
  // wait. It does NOT eliminate it: Render's free plan has no persistent disk
  // (DATA_DIR points at /tmp, wiped on every restart) and spins the service down
  // after ~15 min idle, so most cold starts still begin from zero. That's an
  // infra/plan limitation, not something phase ordering alone can fix.
  logger.info("Phase 2: Fetching candles/MAs...");
  for (const ticker of ALL_TICKERS) {
    await fetchCandlesAndMAs(ticker);
  }
  logger.info("  ✓ Moving averages loaded");

  // Phase 3: Fundamentals (52W H/L, PE, margins, etc.)
  logger.info("Phase 3: Fetching fundamentals...");
  for (const ticker of ALL_TICKERS) {
    await fetchFundamentals(ticker);
  }
  logger.info("  ✓ Fundamentals loaded");

  // Phase 4: Market cap profiles
  logger.info("Phase 4: Fetching profiles...");
  for (const ticker of ALL_TICKERS) {
    await fetchProfile(ticker);
  }
  logger.info("  ✓ Profiles loaded");

  // Phase 5: Analyst recommendations
  logger.info("Phase 5: Fetching recommendations...");
  for (const ticker of ALL_TICKERS) {
    await fetchRecommendations(ticker);
  }
  logger.info("  ✓ Recommendations loaded");

  // Phase 6: EPS surprises (for INS earnings slope)
  logger.info("Phase 6: Fetching earnings surprises...");
  for (const ticker of ALL_TICKERS) {
    await fetchEarnings(ticker);
  }
  logger.info("  ✓ Earnings surprises loaded");

  // Phase 7: SPY candles (for INS relative strength)
  logger.info("Phase 7: Fetching SPY candles...");
  await fetchSpyCandles();
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
      await fetchCandlesAndMAs(ticker);
    }
    for (const ticker of ALL_TICKERS) {
      await fetchFundamentals(ticker);
    }
    for (const ticker of ALL_TICKERS) {
      await fetchRecommendations(ticker);
    }
    for (const ticker of ALL_TICKERS) {
      await fetchEarnings(ticker);
    }
    await fetchSpyCandles();
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

export function getQuote(ticker: string): QuoteData | undefined {
  return quoteCache.get(ticker);
}

export function getSpyCloses60d(): number[] {
  return spyCloses60d;
}

// ── Market Regime Detection ───────────────────────────────────────────────────
// Uses SPY closes already loaded during Phase 7 — no additional API calls.

export function getMarketRegime(): {
  regime: string;
  spyRet5d: number;
  spyRet20d: number;
  spyVolatility: number;
} {
  if (spyCloses60d.length < 21) {
    return { regime: "UNKNOWN", spyRet5d: 0, spyRet20d: 0, spyVolatility: 0 };
  }
  const len  = spyCloses60d.length;
  const curr = spyCloses60d[len - 1]!;
  const c5   = len >= 6  ? spyCloses60d[len - 6]!  : spyCloses60d[0]!;
  const c20  = spyCloses60d[len - 21]!;
  const r5   = (curr - c5)  / c5  * 100;
  const r20  = (curr - c20) / c20 * 100;

  // 20-day daily return std dev as volatility proxy
  const rets: number[] = [];
  for (let i = Math.max(1, len - 20); i < len; i++) {
    const prev = spyCloses60d[i - 1];
    if (prev) rets.push((spyCloses60d[i]! - prev) / prev * 100);
  }
  const m   = rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : 0;
  const vol = rets.length >= 2
    ? Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / rets.length)
    : 0;

  let regime: string;
  if      (vol > 2.5)                  regime = "HIGH VOLATILITY / UNSTABLE";
  else if (r5 > 1.5 && r20 > 4)       regime = "RISK-ON MOMENTUM";
  else if (r20 < -3)                   regime = "DEFENSIVE MARKET";
  else if (r20 > 0 && vol < 1.2)      regime = "QUALITY GROWTH";
  else                                  regime = "NEUTRAL";

  return {
    regime,
    spyRet5d:     Math.round(r5  * 10) / 10,
    spyRet20d:    Math.round(r20 * 10) / 10,
    spyVolatility: Math.round(vol * 100) / 100,
  };
}

// Expose rate-limited fetch so scanner.ts can share the same queue
export { finnhubGet };

export async function startFinnhubService(): Promise<void> {
  if (!FINNHUB_KEY) {
    logger.warn("FINNHUB_API_KEY missing — set it to enable live prices");
    return;
  }
  loadExtCache();
  prewarmExtMetricsCache();
  await loadInitialData();
  connectWebSocket();
  void refreshMarketStatus();
  setInterval(() => void refreshMarketStatus(), 30_000);
  void periodicRestRefresh();
  void periodicMetricsRefresh();
}
