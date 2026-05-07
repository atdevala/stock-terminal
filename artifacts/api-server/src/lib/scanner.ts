import { finnhubGet, getSpyCloses60d, getAllExtendedMetrics, getQuote } from "./finnhub";
import type { ExtendedMetrics } from "./finnhub";
import { computeScore } from "./scores";
import { getInsLabel } from "./ins";
import { TICKER_TO_COMPANY } from "./stocks-data";
import { logger } from "./logger";

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
  SNOW: "Snowflake Inc",
  DDOG: "Datadog Inc",
  NET:  "Cloudflare Inc",
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
  MRVL: "Marvell Technology",
  AMAT: "Applied Materials",
  KLAC: "KLA Corporation",
  MU:   "Micron Technology",
  ASML: "ASML Holding NV",
  TXN:  "Texas Instruments",
  SMCI: "Super Micro Computer",
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

// ── Per-ticker fetches (3 calls per scanner-only ticker) ──────────────────────

async function fetchScannerQuote(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(`/quote?symbol=${ticker}`) as Record<string, number>;
    if (!data["c"]) return;
    scannerPriceCache.set(ticker, { price: data["c"] ?? 0, changePercent: data["dp"] ?? 0 });
  } catch { /* ignore individual failures */ }
}

async function fetchScannerCandles(ticker: string): Promise<void> {
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
    const ext = scannerExtCache.get(ticker) ?? { ticker };
    scannerExtCache.set(ticker, {
      ...ext, ticker,
      closes60d:  closes.slice(-60),
      volumes60d: volumes ? volumes.slice(-60) : ext.volumes60d,
    });
  } catch { /* ignore */ }
}

async function fetchScannerFundamentals(ticker: string): Promise<void> {
  try {
    const data = await finnhubGet(
      `/stock/metric?symbol=${ticker}&metric=all`
    ) as Record<string, unknown>;
    const m = (data["metric"] as Record<string, unknown>) ?? {};
    const ext = scannerExtCache.get(ticker) ?? { ticker };
    scannerExtCache.set(ticker, {
      ...ext, ticker,
      revenueGrowthYoy: nv(m["revenueGrowthTTMYoy"]) ?? nv(m["revenueGrowth3Y"]),
      revenueGrowthQoQ: nv(m["revenueGrowth5Y"]),
      grossMargin:      nv(m["grossMarginTTM"]),
      operatingMargin:  nv(m["operatingMarginTTM"]),
      fcfMargin:        nv(m["fcfMarginTTM"]),
      debtToEquity:     nv(m["totalDebt/totalEquityQuarterly"]),
      pe:               nv(m["peBasicExclExtraTTM"]),
      evSales:          nv(m["priceToSalesRatioTTM"]),
    });
  } catch { /* ignore */ }
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
): ScanResult {
  const scored   = computeScore(ticker, ext, price, changePercent);
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
    all.push(buildScanResult(ext.ticker, company, "watchlist", ext, q.price, q.changePercent, 0));
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
