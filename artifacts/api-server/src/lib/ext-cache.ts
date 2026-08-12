import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";

// ── Path resolution (mirrors signal-history.ts) ───────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = process.env.DATA_DIR ?? path.join(__dirname, "../../data");
const CACHE_FILE = path.join(DATA_DIR, "ext-cache.json");

// ── TTLs ──────────────────────────────────────────────────────────────────────
const TTL_H6  =  6 * 60 * 60 * 1_000;       //  6 h — candles, SPY
const TTL_H24 = 24 * 60 * 60 * 1_000;       // 24 h — fundamentals, recs, earnings
const TTL_D7  =  7 * 24 * 60 * 60 * 1_000;  //  7 d — profiles (almost never change)

// ── Payload shapes ────────────────────────────────────────────────────────────

export interface FundamentalsPayload {
  high52?:           number;
  low52?:            number;
  pe?:               number;
  revenueGrowthYoy?: number;
  revenueGrowthQoQ?: number;
  grossMargin?:      number;
  operatingMargin?:  number;
  fcfMargin?:        number;
  debtToEquity?:     number;
  evSales?:          number;
}

export interface ProfilePayload {
  marketCapMillions?: number;
  /** Finnhub's own industry classification (e.g. "Semiconductors", "Biotechnology") — from /stock/profile2's finnhubIndustry field. */
  industry?: string;
}

export interface CandlesPayload {
  ma50?:      number;
  ma200?:     number;
  closes60d?: number[];
  volumes60d?: number[];
}

export interface RecsPayload {
  earningsRevisionsUp?: boolean;
}

// Insider Form 3/4/5 transactions + monthly sentiment (MSPR). Filings and
// monthly sentiment rollups are updated at most a few times a month — TTL_D7
// (7 days) instead of the 24h fundamentals/recs cadence, since re-fetching
// daily would just replay the same filings almost every time.
export interface InsiderPayload {
  /** Count of open-market Buy (code "P") transactions in the trailing 30 days. */
  insiderBuys30d?: number;
  /** Count of open-market Sell (code "S") transactions in the trailing 30 days. */
  insiderSells30d?: number;
  /** Most recent month's Monthly Share Purchase Ratio: -100 (all selling) to +100 (all buying). */
  insiderMspr?: number;
  /** "YYYY-MM" the MSPR reading above is for. */
  insiderMsprMonth?: string;
}

export interface EarningsPayload {
  epsSurprises?: number[];
}

export interface SpyPayload {
  closes60d: number[];
}

// ── Store shape ───────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; ts: number }

interface CacheStore {
  v:            number;
  fundamentals: Record<string, CacheEntry<FundamentalsPayload>>;
  profiles:     Record<string, CacheEntry<ProfilePayload>>;
  candles:      Record<string, CacheEntry<CandlesPayload>>;
  recs:         Record<string, CacheEntry<RecsPayload>>;
  earnings:     Record<string, CacheEntry<EarningsPayload>>;
  insider:      Record<string, CacheEntry<InsiderPayload>>;
  spy:          CacheEntry<SpyPayload> | null;
}

// ── In-memory store ───────────────────────────────────────────────────────────

let store: CacheStore = {
  v:            1,
  fundamentals: {},
  profiles:     {},
  candles:      {},
  recs:         {},
  earnings:     {},
  insider:      {},
  spy:          null,
};

// ── Disk load (call once at startup) ─────────────────────────────────────────

export function loadExtCache(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      logger.info("Ext-cache: no cache file yet — all data will be fetched fresh");
      return;
    }
    const raw    = fs.readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CacheStore>;
    if (parsed.v !== 1) {
      logger.warn("Ext-cache: version mismatch — starting empty");
      return;
    }
    store = {
      v:            1,
      fundamentals: parsed.fundamentals ?? {},
      profiles:     parsed.profiles     ?? {},
      candles:      parsed.candles      ?? {},
      recs:         parsed.recs         ?? {},
      earnings:     parsed.earnings     ?? {},
      insider:      parsed.insider      ?? {},
      spy:          parsed.spy          ?? null,
    };
    const n = Object.keys(store.fundamentals).length;
    logger.info(`Ext-cache loaded — ${n} tickers cached (slow fetches will be skipped where fresh)`);
  } catch (err) {
    logger.warn({ err }, "Ext-cache load failed — starting empty");
  }
}

// ── Debounced disk write ──────────────────────────────────────────────────────

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(store), "utf-8");
    } catch (err) {
      logger.warn({ err }, "Ext-cache write failed");
    }
  }, 5_000);
}

// ── Freshness helper ──────────────────────────────────────────────────────────

function isFresh(ts: number, ttl: number): boolean {
  return Date.now() - ts < ttl;
}

// ── Fundamentals ──────────────────────────────────────────────────────────────

export function getCachedFundamentals(ticker: string): FundamentalsPayload | null {
  const e = store.fundamentals[ticker];
  return e && isFresh(e.ts, TTL_H24) ? e.data : null;
}
export function getCachedFundamentalsRaw(ticker: string): FundamentalsPayload | null {
  return store.fundamentals[ticker]?.data ?? null;
}
export function setCachedFundamentals(ticker: string, data: FundamentalsPayload): void {
  store.fundamentals[ticker] = { data, ts: Date.now() };
  scheduleSave();
}
// TEMPORARY — diagnostic for the high52/low52-empty-everywhere bug. Exposes
// the raw cache entry (including its age) so a debug route can show whether
// disk-persisted fundamentals entries are stale/incomplete. Remove once fixed.
export function getFundamentalsCacheDebugInfo(ticker: string): { data: FundamentalsPayload; ageHours: number } | null {
  const e = store.fundamentals[ticker];
  if (!e) return null;
  return { data: e.data, ageHours: Math.round((Date.now() - e.ts) / (60 * 60 * 1000) * 10) / 10 };
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export function getCachedProfile(ticker: string): ProfilePayload | null {
  const e = store.profiles[ticker];
  return e && isFresh(e.ts, TTL_D7) ? e.data : null;
}
export function setCachedProfile(ticker: string, data: ProfilePayload): void {
  store.profiles[ticker] = { data, ts: Date.now() };
  scheduleSave();
}

// ── Candles ───────────────────────────────────────────────────────────────────

export function getCachedCandles(ticker: string): CandlesPayload | null {
  const e = store.candles[ticker];
  return e && isFresh(e.ts, TTL_H6) ? e.data : null;
}
export function getCachedCandlesRaw(ticker: string): CandlesPayload | null {
  return store.candles[ticker]?.data ?? null;
}
export function setCachedCandles(ticker: string, data: CandlesPayload): void {
  store.candles[ticker] = { data, ts: Date.now() };
  scheduleSave();
}

// ── Recommendations ───────────────────────────────────────────────────────────

export function getCachedRecs(ticker: string): RecsPayload | null {
  const e = store.recs[ticker];
  return e && isFresh(e.ts, TTL_H24) ? e.data : null;
}
export function getCachedRecsRaw(ticker: string): RecsPayload | null {
  return store.recs[ticker]?.data ?? null;
}
export function setCachedRecs(ticker: string, data: RecsPayload): void {
  store.recs[ticker] = { data, ts: Date.now() };
  scheduleSave();
}

// ── Earnings ──────────────────────────────────────────────────────────────────

export function getCachedEarnings(ticker: string): EarningsPayload | null {
  const e = store.earnings[ticker];
  return e && isFresh(e.ts, TTL_H24) ? e.data : null;
}
export function getCachedEarningsRaw(ticker: string): EarningsPayload | null {
  return store.earnings[ticker]?.data ?? null;
}
export function setCachedEarnings(ticker: string, data: EarningsPayload): void {
  store.earnings[ticker] = { data, ts: Date.now() };
  scheduleSave();
}

// ── Insider activity ──────────────────────────────────────────────────────────

export function getCachedInsider(ticker: string): InsiderPayload | null {
  const e = store.insider[ticker];
  return e && isFresh(e.ts, TTL_D7) ? e.data : null;
}
export function getCachedInsiderRaw(ticker: string): InsiderPayload | null {
  return store.insider[ticker]?.data ?? null;
}
export function setCachedInsider(ticker: string, data: InsiderPayload): void {
  store.insider[ticker] = { data, ts: Date.now() };
  scheduleSave();
}

// ── SPY ───────────────────────────────────────────────────────────────────────

export function getCachedSpy(): SpyPayload | null {
  const e = store.spy;
  return e && isFresh(e.ts, TTL_H6) ? e.data : null;
}
export function getCachedSpyRaw(): SpyPayload | null {
  return store.spy?.data ?? null;
}
export function setCachedSpy(data: SpyPayload): void {
  store.spy = { data, ts: Date.now() };
  scheduleSave();
}
