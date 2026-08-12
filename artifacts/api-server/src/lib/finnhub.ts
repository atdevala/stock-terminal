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
  getCachedInsider,      setCachedInsider,
  getCachedSpy,          setCachedSpy,
  getCachedFundamentalsRaw,
  getCachedCandlesRaw,
  getCachedRecsRaw,
  getCachedEarningsRaw,
  getCachedInsiderRaw,
  getCachedSpyRaw,
  type FundamentalsPayload,
  type CandlesPayload,
  type InsiderPayload,
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
  /** Finnhub's own industry classification (e.g. "Semiconductors", "Biotechnology", "Software") — from /stock/profile2's finnhubIndustry field. Data-only for now; not yet used by any scoring math (see scores.ts). */
  industry?: string;
  /** Count of open-market Buy (code "P") transactions in the trailing 30 days, from Form 3/4/5 filings. */
  insiderBuys30d?: number;
  /** Count of open-market Sell (code "S") transactions in the trailing 30 days, from Form 3/4/5 filings. */
  insiderSells30d?: number;
  /** Most recent month's Monthly Share Purchase Ratio: -100 (all selling) to +100 (all buying). */
  insiderMspr?: number;
  /** "YYYY-MM" the MSPR reading above is for. */
  insiderMsprMonth?: string;
}

// ── closes60d live-price audit — the ONE shared "append today's price" helper ──
// closes60d is populated from completed daily candles (refreshed on its own
// TTL cycle), which lags same-day price action by definition — the day's
// candle isn't finalized until the session closes. Anything computed from
// closes60d that's supposed to describe the CURRENT moment (RSI, MACD, short
// -window momentum/trend reads) rather than a completed multi-day structure
// needs to see today's live price, or it silently answers "as of yesterday's
// close" instead of "right now."
//
// This was the confirmed root cause of a real production bug: RSI computed
// from a candle series with no way to know about today's move stayed at
// "59/Neutral" for a stock that was actually up 29% intraday. Several call
// sites had already reinvented this exact append inline (ins.ts, scanner.ts)
// before it was named — consolidated here as the one canonical implementation
// so future callers reach for this instead of writing `[...closes, price]`
// again. Lives in finnhub.ts (not scores.ts) specifically so ins.ts can import
// it without creating a scores.ts↔ins.ts circular dependency.
//
// Guards currentPrice > 0 so a not-yet-loaded quote (0) can't corrupt the
// series with a fake 100% drop.
export function appendLivePrice(closes: number[] | undefined, currentPrice: number): number[] {
  const base = closes ?? [];
  if (currentPrice <= 0) return base;
  return [...base, currentPrice];
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

// ── Bounded-concurrency batch helper ─────────────────────────────────────────
// Every fetch phase below used to loop `for (const ticker of ALL_TICKERS) {
// await fetchXxx(ticker); }` — one ticker at a time. The shared rate limiter
// above already correctly caps real Finnhub calls at ~40/min regardless of
// how many callers are in flight (confirmed: every TTL-cached fetch function
// — candles, fundamentals, profiles, recs, earnings — checks its on-disk
// cache and returns BEFORE ever calling enqueue()/finnhubGet(), so a cache
// hit never touches the queue at all). But the one-at-a-time loop meant a
// single ticker needing a real fetch (new ticker, or expired TTL) blocked
// every ticker AFTER it in the array from even checking its OWN cache —
// including tickers that would resolve instantly. As the universe grows
// (more new/expired tickers mixed among more already-cached ones), that
// artificial serialization gets worse even though the real bottleneck
// (Finnhub's rate limit) hasn't changed.
//
// Concurrency limit: 10. This does NOT raise how fast real Finnhub calls
// happen — that's still fully governed by RATE_INTERVAL_MS above. It's
// chosen so that (a) a full batch of cache-hit tickers resolves as one wave
// instead of one at a time, and (b) the Yahoo-candle fallback in
// fetchCandlesAndMAs — which does NOT go through Finnhub's queue, since
// it's a different provider — can't fire more than 10 simultaneous outbound
// requests even if many tickers need it at once (e.g. right after a cache
// wipe with Finnhub's own candle endpoint degraded, as happened earlier).
const FETCH_CONCURRENCY = 10;

async function runBatched<T>(items: readonly T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += FETCH_CONCURRENCY) {
    const batch = items.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(batch.map(fn));
  }
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
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, industry: cached.industry });
    return;
  }
  try {
    const data = await finnhubGet(`/stock/profile2?symbol=${ticker}`) as Record<string, unknown>;
    const mcapMillions = data["marketCapitalization"] as number | null | undefined;
    const industry = data["finnhubIndustry"] as string | null | undefined;
    const existing = quoteCache.get(ticker);
    if (existing && mcapMillions) {
      quoteCache.set(ticker, { ...existing, marketCap: fmtMcap(mcapMillions * 1e6) });
    }
    setCachedProfile(ticker, { marketCapMillions: mcapMillions ?? undefined, industry: industry ?? undefined });
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, { ...ext, ticker, industry: industry ?? undefined });
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

// Verified live against this project's real (free-tier) API key before
// building this: /stock/insider-transactions and /stock/insider-sentiment
// both return real data on the free tier; /stock/short-interest and
// /institutional/ownership both 403 (premium-required) on this plan, so
// neither is wired in. Only a summarized signal is kept (buy/sell counts +
// latest MSPR reading), never the raw transaction list — that's all
// scoreFacts() needs, and it keeps the AI context small.
async function fetchInsiderActivity(ticker: string): Promise<void> {
  const cached = getCachedInsider(ticker);
  if (cached) {
    const ext = extMetricsCache.get(ticker) ?? { ticker };
    extMetricsCache.set(ticker, {
      ...ext, ticker,
      insiderBuys30d:   cached.insiderBuys30d,
      insiderSells30d:  cached.insiderSells30d,
      insiderMspr:      cached.insiderMspr,
      insiderMsprMonth: cached.insiderMsprMonth,
    });
    return;
  }

  const payload: InsiderPayload = {};

  try {
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 86400 * 1000); // 90d window, plenty of margin for a 30d rollup
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const data = await finnhubGet(
      `/stock/insider-transactions?symbol=${ticker}&from=${fmt(from)}&to=${fmt(to)}`
    ) as { data?: Array<Record<string, unknown>> };

    const cutoff = to.getTime() - 30 * 86400 * 1000;
    const rows = Array.isArray(data.data) ? data.data : [];
    let buys = 0;
    let sells = 0;
    for (const row of rows) {
      const txDate = new Date(String(row["transactionDate"] ?? "")).getTime();
      if (isNaN(txDate) || txDate < cutoff) continue;
      const code = row["transactionCode"];
      if (code === "P") buys++;
      else if (code === "S") sells++;
    }
    payload.insiderBuys30d = buys;
    payload.insiderSells30d = sells;
  } catch (err) {
    logger.warn({ ticker, err }, "Insider transactions fetch failed");
  }

  try {
    const to = new Date();
    const from = new Date(to.getTime() - 400 * 86400 * 1000); // wide window; take the latest month present
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const data = await finnhubGet(
      `/stock/insider-sentiment?symbol=${ticker}&from=${fmt(from)}&to=${fmt(to)}`
    ) as { data?: Array<{ year?: number; month?: number; mspr?: number }> };

    const rows = Array.isArray(data.data) ? data.data : [];
    const latest = rows.reduce<{ year: number; month: number; mspr: number } | null>((acc, row) => {
      if (row.year === undefined || row.month === undefined || row.mspr === undefined) return acc;
      if (!acc || row.year > acc.year || (row.year === acc.year && row.month > acc.month)) {
        return { year: row.year, month: row.month, mspr: row.mspr };
      }
      return acc;
    }, null);

    if (latest) {
      payload.insiderMspr = latest.mspr;
      payload.insiderMsprMonth = `${latest.year}-${String(latest.month).padStart(2, "0")}`;
    }
  } catch (err) {
    logger.warn({ ticker, err }, "Insider sentiment fetch failed");
  }

  if (payload.insiderBuys30d === undefined && payload.insiderMspr === undefined) return;

  setCachedInsider(ticker, payload);
  const ext = extMetricsCache.get(ticker) ?? { ticker };
  extMetricsCache.set(ticker, {
    ...ext, ticker,
    insiderBuys30d:   payload.insiderBuys30d,
    insiderSells30d:  payload.insiderSells30d,
    insiderMspr:      payload.insiderMspr,
    insiderMsprMonth: payload.insiderMsprMonth,
  });
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
    const insider      = getCachedInsiderRaw(ticker);

    if (!fundamentals && !candles && !recs && !earnings && !insider) continue;

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
      ...(insider ? {
        insiderBuys30d:   insider.insiderBuys30d,
        insiderSells30d:  insider.insiderSells30d,
        insiderMspr:      insider.insiderMspr,
        insiderMsprMonth: insider.insiderMsprMonth,
      } : {}),
    });
    count++;
  }

  // Also prewarm SPY closes so market-regime and INS relative-strength work immediately
  const spy = getCachedSpyRaw();
  if (spy) spyCloses60d = spy.closes60d;

  logger.info(`Ext-cache prewarm complete — ${count} tickers ready for scoring`);
}

// ── Sequential startup phases ─────────────────────────────────────────────────
// Phases still run one after another (candles need to exist before scoring
// leans on them, etc.). WITHIN each phase, tickers are processed in bounded
// concurrent batches (runBatched, FETCH_CONCURRENCY above) rather than one at
// a time — real Finnhub calls still can't exceed the shared rate limit
// regardless, so this only removes artificial waiting between UNRELATED
// tickers (a cache hit no longer sits behind an unrelated cache miss).

async function loadInitialData(): Promise<void> {
  if (!FINNHUB_KEY) {
    logger.warn("FINNHUB_API_KEY not set — live prices unavailable");
    return;
  }

  // Phase 1: REST quotes
  logger.info("Phase 1: Fetching quotes...");
  await runBatched(ALL_TICKERS, fetchQuoteRest);
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
  await runBatched(ALL_TICKERS, fetchCandlesAndMAs);
  logger.info("  ✓ Moving averages loaded");

  // Phase 3: Fundamentals (52W H/L, PE, margins, etc.)
  logger.info("Phase 3: Fetching fundamentals...");
  await runBatched(ALL_TICKERS, fetchFundamentals);
  logger.info("  ✓ Fundamentals loaded");

  // Phase 4: Market cap profiles
  logger.info("Phase 4: Fetching profiles...");
  await runBatched(ALL_TICKERS, fetchProfile);
  logger.info("  ✓ Profiles loaded");

  // Phase 5: Analyst recommendations
  logger.info("Phase 5: Fetching recommendations...");
  await runBatched(ALL_TICKERS, fetchRecommendations);
  logger.info("  ✓ Recommendations loaded");

  // Phase 6: EPS surprises (for INS earnings slope)
  logger.info("Phase 6: Fetching earnings surprises...");
  await runBatched(ALL_TICKERS, fetchEarnings);
  logger.info("  ✓ Earnings surprises loaded");

  // Phase 7: SPY candles (for INS relative strength)
  logger.info("Phase 7: Fetching SPY candles...");
  await fetchSpyCandles();
}

// Phase 8: Insider transactions + sentiment. NOT awaited from loadInitialData
// and not part of the sequential phase list above — nothing in scoring reads
// this data (it's AI-write-up-context only, see ai-context-service.ts), and a
// cold-start universe with no existing ext-cache would add ~150 tickers x 2
// calls x 1.5s = ~7.5 minutes to warm-up if it blocked readiness. Firing it
// as a background task after Phase 1-7 finish means /api/scores is never
// waiting on it — insider facts simply appear a few minutes later as this
// phase completes in the background, and TTL_D7 means that cost is paid at
// most once a week per ticker regardless.
async function loadInsiderDataInBackground(): Promise<void> {
  logger.info("Phase 8 (background): Fetching insider transactions/sentiment...");
  await runBatched(ALL_TICKERS, fetchInsiderActivity);
  logger.info("  ✓ Insider transactions/sentiment loaded");
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
    await runBatched(ALL_TICKERS, fetchQuoteRest);
  }
}

async function periodicMetricsRefresh(): Promise<void> {
  while (true) {
    await sleep(6 * 60 * 60 * 1000);
    await runBatched(ALL_TICKERS, fetchCandlesAndMAs);
    await runBatched(ALL_TICKERS, fetchFundamentals);
    await runBatched(ALL_TICKERS, fetchRecommendations);
    await runBatched(ALL_TICKERS, fetchEarnings);
    // Same self-gating pattern as the calls above: fetchInsiderActivity checks
    // its own 7-day cache before ever touching the network, so running it in
    // this 6h loop doesn't mean 4x/day real calls — just a same-day-cached
    // no-op on 27 of every 28 passes.
    await runBatched(ALL_TICKERS, fetchInsiderActivity);
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
  void loadInsiderDataInBackground();
}
