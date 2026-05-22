import { finnhubGet, getSpyCloses60d, getAllExtendedMetrics, getQuote } from "./finnhub";
import type { ExtendedMetrics, QuoteData } from "./finnhub";
import { computeScore, type StockScore } from "./scores";
import { getInsLabel } from "./ins";
import { TICKER_TO_COMPANY } from "./stocks-data";
import { logger } from "./logger";
import {
  getCachedCandles,      setCachedCandles,
  getCachedFundamentals, setCachedFundamentals,
} from "./ext-cache";

// ── Scanner universe: 50 high-momentum stocks beyond the watchlist ─────────────
export const SCANNER_UNIVERSE: Record<string, string> = {
  // Large Cap Tech
  MSFT: "Microsoft Corp",
  AAPL: "Apple Inc",
  GOOG: "Alphabet Inc",
  META: "Meta Platforms",
  AMZN: "Amazon.com Inc",
  TSLA: "Tesla Inc",
  // Cloud / SaaS
  CRM:  "Salesforce Inc",
  DDOG: "Datadog Inc",
  MDB:  "MongoDB Inc",
  NOW:  "ServiceNow Inc",
  WDAY: "Workday Inc",
  HUBS: "HubSpot Inc",
  TTD:  "The Trade Desk",
  // Cybersecurity
  PANW: "Palo Alto Networks",
  ZS:   "Zscaler Inc",
  CRWD: "CrowdStrike Holdings",
  FTNT: "Fortinet Inc",
  // Finance / Fintech
  V:    "Visa Inc",
  MA:   "Mastercard Inc",
  PYPL: "PayPal Holdings",
  COIN: "Coinbase Global",
  AFRM: "Affirm Holdings",
  NU:   "Nu Holdings",
  SQ:   "Block Inc",
  // Semiconductors
  QCOM: "Qualcomm Inc",
  AMAT: "Applied Materials",
  MU:   "Micron Technology",
  ASML: "ASML Holding NV",
  TXN:  "Texas Instruments",
  // Healthcare / Biotech
  LLY:  "Eli Lilly and Co",
  ABBV: "AbbVie Inc",
  MRNA: "Moderna Inc",
  VRTX: "Vertex Pharmaceuticals",
  // Consumer / Platform
  UBER: "Uber Technologies",
  DASH: "DoorDash Inc",
  ABNB: "Airbnb Inc",
  SHOP: "Shopify Inc",
  MELI: "MercadoLibre Inc",
  // Other High-Momentum Growth
  AXON: "Axon Enterprise",
  CELH: "Celsius Holdings",
  MSTR: "Strategy (MicroStrategy)",
  HOOD: "Robinhood Markets",
  DUOL: "Duolingo Inc",
  CAVA: "CAVA Group Inc",
  RBLX: "Roblox Corp",
  APP:  "Applovin Corp",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScanResult {
  rank: number;
  ticker: string;
  company: string;
  source: "watchlist" | "scanner";
  ins: number;
  insLabel: string;
  cos: number;
  gvs: number;
  vqs: number;
  acs: number;
  fbrs: number;
  trendLabel: string;
  convictionTier: number;
  isSuperstock: boolean;
  breakoutScore: number;
  insMomentum: number;
  divergenceTag: string;
  alert: string;
  insComponents?: {
    deltaGvs: number;
    deltaVqs: number;
    volumeAccel: number;
    epsSlope: number;
    narrativeMomentum: number;
  };
}

export interface ScannerResponse {
  status: "idle" | "loading" | "complete";
  lastScanTime: number;
  progress: { done: number; total: number };
  results: ScanResult[];
}

export interface SymbolScanSuccess {
  ok: true;
  source: "on-demand";
  cached: boolean;
  result: {
    ticker: string;
    company: string;
    score: StockScore;
    quote: {
      ticker: string;
      price: number;
      changePercent: number;
    };
    scannedAt: number;
  };
}

export interface SymbolScanFailure {
  ok: false;
  status: 400 | 404 | 502;
  error: string;
  reason: "INVALID_SYMBOL" | "NO_DATA" | "PROVIDER_ERROR";
}

export type SymbolScanResponse = SymbolScanSuccess | SymbolScanFailure;

// ── Internal state ─────────────────────────────────────────────────────────────

const scannerExtCache  = new Map<string, ExtendedMetrics>();
const scannerPriceCache = new Map<string, { price: number; changePercent: number }>();

let scannerState: ScannerResponse = {
  status:      "idle",
  lastScanTime: 0,
  progress:    { done: 0, total: 0 },
  results:     [],
};
let scanRunning = false;

const CACHE_TTL_MS = 15 * 60 * 1000;
const SYMBOL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let usSymbolCache: {
  loadedAt: number;
  symbols: Map<string, string>;
} | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function nv(v: unknown): number | undefined {
  const n = Number(v);
  return (v === null || v === undefined || isNaN(n)) ? undefined : n;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeTicker(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ticker = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) return undefined;
  return ticker;
}

function quoteFromScannerCache(ticker: string, price: number, changePercent: number): QuoteData {
  const prevClose = changePercent !== -100
    ? price / (1 + changePercent / 100)
    : price;
  return {
    ticker,
    price,
    change: price - prevClose,
    changePercent,
    prevClose,
    high: price,
    low: price,
    open: prevClose,
    lastUpdated: Date.now(),
  };
}

// ── Per-ticker fetches (3 calls per scanner-only ticker) ──────────────────────

async function fetchScannerQuote(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/quote?symbol=${ticker}`) as Record<string, number>;
    if (!data["c"]) return;
    scannerPriceCache.set(ticker, { price: data["c"] ?? 0, changePercent: data["dp"] ?? 0 });
  } catch { /* ignore individual failures */ }
}

async function fetchScannerCandles(ticker: string): Promise<void> {
  const cached = getCachedCandles(ticker);
  if (cached) {
    const ext = scannerExtCache.get(ticker) ?? { ticker };
    scannerExtCache.set(ticker, {
      ...ext, ticker,
      closes60d:  cached.closes60d,
      volumes60d: cached.volumes60d,
    });
    return;
  }
  try {
    const to   = Math.floor(Date.now() / 1000);
    const from = to - 90 * 86400;
    const data = await finnhubGet(
      `/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${to}`
    ) as Record<string, unknown>;
    if (data["s"] !== "ok") return;
    const closes  = data["c"] as number[];
    const volumes = data["v"] as number[] | undefined;
    if (!closes || closes.length < 10) return;
    const closes60d  = closes.slice(-60);
    const volumes60d = volumes ? volumes.slice(-60) : undefined;
    setCachedCandles(ticker, { closes60d, volumes60d });
    const ext = scannerExtCache.get(ticker) ?? { ticker };
    scannerExtCache.set(ticker, {
      ...ext, ticker,
      closes60d,
      volumes60d: volumes60d ?? ext.volumes60d,
    });
  } catch { /* ignore */ }
}

async function fetchScannerFundamentals(ticker: string): Promise<void> {
  const cached = getCachedFundamentals(ticker);
  if (cached) {
    const ext = scannerExtCache.get(ticker) ?? { ticker };
    scannerExtCache.set(ticker, {
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
    const data = await finnhubGet(
      `/stock/metric?symbol=${ticker}&metric=all`
    ) as Record<string, unknown>;
    const m = (data["metric"] as Record<string, unknown>) ?? {};
    const payload = {
      revenueGrowthYoy: nv(m["revenueGrowthTTMYoy"]) ?? nv(m["revenueGrowth3Y"]),
      revenueGrowthQoQ: nv(m["revenueGrowth5Y"]),
      grossMargin:      nv(m["grossMarginTTM"]),
      operatingMargin:  nv(m["operatingMarginTTM"]),
      fcfMargin:        nv(m["fcfMarginTTM"]),
      debtToEquity:     nv(m["totalDebt/totalEquityQuarterly"]),
      pe:               nv(m["peBasicExclExtraTTM"]),
      evSales:          nv(m["priceToSalesRatioTTM"]),
    };
    setCachedFundamentals(ticker, payload);
    const ext = scannerExtCache.get(ticker) ?? { ticker };
    scannerExtCache.set(ticker, { ...ext, ticker, ...payload });
  } catch { /* ignore */ }
}

async function loadUsSymbolUniverse(): Promise<Map<string, string> | undefined> {
  if (usSymbolCache && Date.now() - usSymbolCache.loadedAt < SYMBOL_CACHE_TTL_MS) {
    return usSymbolCache.symbols;
  }

  try {
    const data = await finnhubGet("/stock/symbol?exchange=US") as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return usSymbolCache?.symbols;

    const symbols = new Map<string, string>();
    for (const item of data) {
      const rawSymbol = String(item["symbol"] ?? item["displaySymbol"] ?? "").toUpperCase();
      const displaySymbol = String(item["displaySymbol"] ?? rawSymbol).toUpperCase();
      const description = String(item["description"] ?? rawSymbol);
      const type = String(item["type"] ?? "").toLowerCase();

      if (!rawSymbol || rawSymbol.includes(".")) continue;
      if (!/^[A-Z][A-Z0-9-]{0,14}$/.test(rawSymbol)) continue;
      if (displaySymbol !== rawSymbol) continue;
      if (type && !/(common|stock|adr|etf|fund|reit|unit|equity)/i.test(type)) continue;

      symbols.set(rawSymbol, description || rawSymbol);
    }

    usSymbolCache = { loadedAt: Date.now(), symbols };
    logger.info(`Scanner symbol universe cached: ${symbols.size} U.S. symbols`);
    return symbols;
  } catch (err) {
    logger.warn({ err }, "Scanner symbol universe fetch failed");
    return usSymbolCache?.symbols;
  }
}

async function resolveCompanyName(ticker: string): Promise<string | undefined> {
  if (TICKER_TO_COMPANY[ticker]) return TICKER_TO_COMPANY[ticker];
  if (SCANNER_UNIVERSE[ticker]) return SCANNER_UNIVERSE[ticker];

  const symbols = await loadUsSymbolUniverse();
  if (!symbols) return ticker;
  return symbols.get(ticker);
}

// ── Score helpers ─────────────────────────────────────────────────────────────

// 7-day momentum proxy: compares 7d return vs the prior 7d return
function computeInsMomentum7d(closes: number[], currentPrice: number): number {
  const all = closes.length > 0 ? [...closes, currentPrice] : [currentPrice];
  if (all.length < 15) return 50;
  const curr  = all[all.length - 1]!;
  const c7    = all[all.length - 8]!;
  const c14   = all[all.length - 15]!;
  if (!c7 || !c14) return 50;
  const ret7d  = (curr - c7)  / c7  * 100;
  const pret7d = (c7   - c14) / c14 * 100;
  return clamp(50 + (ret7d - pret7d) * 3, 0, 100);
}

function scannerDivTag(ins: number, cos: number): string {
  if (ins > 70 && cos < 65) return "EARLY OPPORTUNITY";
  if (cos > 70 && ins < 50) return "LATE CYCLE RISK";
  if (ins > 75 && cos > 70) return "CRDO-TYPE SETUP";
  return "";
}

function computeAlert(ins: number, cos: number, deltaGvs: number): string {
  if (ins > 60 && deltaGvs > 60 && cos < 65) return "EARLY IGNITION ZONE";
  if (cos > 70 && ins < 50)                   return "EXHAUSTION WARNING";
  return "";
}

function buildScanResult(
  ticker: string,
  company: string,
  source: "watchlist" | "scanner",
  ext: ExtendedMetrics,
  price: number,
  changePercent: number,
  rank: number,
  quote?: QuoteData,
): ScanResult {
  const scored   = computeScore(ticker, ext, price, changePercent, quote);
  const ins      = scored.ins ?? 0;
  const insMom   = computeInsMomentum7d(ext.closes60d ?? [], price);
  const volAccel = scored.insComponents?.volumeAccel ?? 50;

  return {
    rank,
    ticker,
    company,
    source,
    ins,
    insLabel:       scored.insLabel ?? getInsLabel(ins),
    cos:            scored.cos,
    gvs:            scored.gvs,
    vqs:            scored.vqs,
    acs:            scored.acs,
    fbrs:           scored.fbrs,
    trendLabel:     scored.trendLabel,
    convictionTier: scored.convictionTier,
    isSuperstock:   scored.isSuperstock,
    breakoutScore:  Math.round(clamp(0.5 * ins + 0.3 * insMom + 0.2 * volAccel)),
    insMomentum:    Math.round(insMom),
    divergenceTag:  scannerDivTag(ins, scored.cos),
    alert:          computeAlert(ins, scored.cos, scored.insComponents?.deltaGvs ?? 50),
    insComponents:  scored.insComponents,
  };
}

// ── Main scan ─────────────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  if (scanRunning) return;
  scanRunning = true;

  const scannerOnlyTickers = Object.keys(SCANNER_UNIVERSE);
  scannerState = {
    ...scannerState,
    status:   "loading",
    progress: { done: 0, total: scannerOnlyTickers.length },
  };

  logger.info(`Scanner: scanning ${scannerOnlyTickers.length} additional tickers`);

  for (let i = 0; i < scannerOnlyTickers.length; i++) {
    const ticker = scannerOnlyTickers[i]!;
    await fetchScannerQuote(ticker);
    await fetchScannerCandles(ticker);
    await fetchScannerFundamentals(ticker);
    scannerState = {
      ...scannerState,
      progress: { done: i + 1, total: scannerOnlyTickers.length },
    };
  }

  // Compile: watchlist stocks (full data) + scanner-only stocks
  const all: ScanResult[] = [];

  for (const ext of getAllExtendedMetrics()) {
    const q = getQuote(ext.ticker);
    if (!q || q.price === 0) continue;
    const company = TICKER_TO_COMPANY[ext.ticker] ?? ext.ticker;
    all.push(buildScanResult(ext.ticker, company, "watchlist", ext, q.price, q.changePercent, 0, q));
  }

  for (const [ticker, company] of Object.entries(SCANNER_UNIVERSE)) {
    const ext = scannerExtCache.get(ticker);
    const q   = scannerPriceCache.get(ticker);
    if (!ext || !q || q.price === 0) continue;
    all.push(buildScanResult(ticker, company, "scanner", ext, q.price, q.changePercent, 0));
  }

  all.sort((a, b) => b.ins - a.ins || b.breakoutScore - a.breakoutScore);
  all.forEach((r, i) => { r.rank = i + 1; });

  scannerState = {
    status:      "complete",
    lastScanTime: Date.now(),
    progress:    { done: scannerOnlyTickers.length, total: scannerOnlyTickers.length },
    results:     all,
  };

  logger.info(
    `Scanner: complete — ${all.length} stocks · top INS: ${all[0]?.ins ?? 0} (${all[0]?.ticker ?? "—"})`
  );
  scanRunning = false;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getScannerState(): ScannerResponse {
  return scannerState;
}

export function triggerScan(): void {
  if (scanRunning) {
    logger.info("Scanner: already running, skipping trigger");
    return;
  }
  if (scannerState.status === "complete" && Date.now() - scannerState.lastScanTime < CACHE_TTL_MS) {
    logger.info("Scanner: cache valid, skipping trigger");
    return;
  }
  void runScan();
}

export async function scanSymbol(rawTicker: unknown): Promise<SymbolScanResponse> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) {
    return {
      ok: false,
      status: 400,
      error: "Enter a valid U.S. ticker symbol.",
      reason: "INVALID_SYMBOL",
    };
  }

  const company = await resolveCompanyName(ticker);
  if (!company) {
    return {
      ok: false,
      status: 404,
      error: `${ticker} is not in Finnhub's U.S. symbol universe.`,
      reason: "INVALID_SYMBOL",
    };
  }

  const existingExt = getAllExtendedMetrics().find(ext => ext.ticker === ticker) ?? scannerExtCache.get(ticker);
  const existingQuote = getQuote(ticker);
  const existingScannerQuote = scannerPriceCache.get(ticker);
  const cached = Boolean(existingExt && (existingQuote || existingScannerQuote));

  if (!cached) {
    await fetchScannerQuote(ticker);
    await fetchScannerCandles(ticker);
    await fetchScannerFundamentals(ticker);
  }

  const ext = getAllExtendedMetrics().find(item => item.ticker === ticker) ?? scannerExtCache.get(ticker);
  const q = getQuote(ticker);
  const scannerQuote = scannerPriceCache.get(ticker);

  if (!ext || (!q && !scannerQuote)) {
    return {
      ok: false,
      status: 404,
      error: `No usable quote and fundamentals data is available for ${ticker}.`,
      reason: "NO_DATA",
    };
  }

  try {
    const quote = q ?? quoteFromScannerCache(ticker, scannerQuote!.price, scannerQuote!.changePercent);
    const score = computeScore(ticker, ext, quote.price, quote.changePercent, quote);

    return {
      ok: true,
      source: "on-demand",
      cached,
      result: {
        ticker,
        company,
        score,
        quote: {
          ticker,
          price: quote.price,
          changePercent: quote.changePercent,
        },
        scannedAt: Date.now(),
      },
    };
  } catch (err) {
    logger.warn({ ticker, err }, "On-demand scanner symbol failed");
    return {
      ok: false,
      status: 502,
      error: `Provider data could not be scored for ${ticker}.`,
      reason: "PROVIDER_ERROR",
    };
  }
}

export async function startScannerService(): Promise<void> {
  // Brief delay so the server is fully up before scanner starts competing for the rate queue
  await sleep(10_000);
  logger.info("Scanner service starting — initial scan queued");
  void runScan();
  // Periodic check every 5 minutes; re-scans when cache is expired
  setInterval(() => {
    if (!scanRunning && Date.now() - scannerState.lastScanTime >= CACHE_TTL_MS) {
      logger.info("Scanner: cache expired — starting periodic scan");
      void runScan();
    }
  }, 5 * 60_000);
}
