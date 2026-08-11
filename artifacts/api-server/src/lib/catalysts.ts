import { CATEGORIES } from "./stocks-data";
import { logger } from "./logger";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? "";
const ALL_TICKERS = new Set(CATEGORIES.flatMap(c => c.stocks.map(s => s.ticker)));

// ── Earnings calendar (real dates, not a derived score) ────────────────────────
// This is deliberately separate from CPE/signalScore — nothing here is inferred
// from price or volume. It's just "who on the watchlist universe reports, and
// when," pulled straight from Finnhub's earnings calendar endpoint.

export interface EarningsEvent {
  ticker: string;
  date: string;         // YYYY-MM-DD
  hour: "bmo" | "amc" | "dmh" | "unknown"; // before/after market, during, unknown
  onWatchlist: boolean;
  epsEstimate?: number;
}

let earningsCache: { fetchedAt: number; events: EarningsEvent[] } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — earnings dates don't move often

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getEarningsCalendar(daysAhead = 10): Promise<EarningsEvent[]> {
  if (earningsCache && Date.now() - earningsCache.fetchedAt < CACHE_TTL_MS) {
    return earningsCache.events;
  }

  const from = fmtDate(new Date());
  const to = fmtDate(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000));

  try {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) throw new Error(`Finnhub earnings calendar → ${resp.status}`);
    const data = await resp.json() as { earningsCalendar?: Array<Record<string, unknown>> };
    const rows = data.earningsCalendar ?? [];

    const events: EarningsEvent[] = rows.map(r => ({
      ticker: String(r["symbol"] ?? ""),
      date: String(r["date"] ?? ""),
      hour: (r["hour"] as EarningsEvent["hour"]) ?? "unknown",
      onWatchlist: ALL_TICKERS.has(String(r["symbol"] ?? "")),
      epsEstimate: typeof r["epsEstimate"] === "number" ? r["epsEstimate"] as number : undefined,
    })).filter(e => e.ticker);

    // Surface watchlist names first, then sort by date.
    events.sort((a, b) => {
      if (a.onWatchlist !== b.onWatchlist) return a.onWatchlist ? -1 : 1;
      return a.date.localeCompare(b.date);
    });

    earningsCache = { fetchedAt: Date.now(), events };
    return events;
  } catch (err) {
    logger.warn({ err }, "getEarningsCalendar failed — returning stale/empty cache");
    return earningsCache?.events ?? [];
  }
}

// ── Synchronous earnings-proximity lookup (for INS) ─────────────────────────
// computeScore() runs synchronously across the whole watchlist on every
// /scores request, but getEarningsCalendar() is an async network call cached
// for 6h. Rather than making scoring async, INS's earnings-proximity
// component reads whatever is already cached here and treats "nothing cached
// yet" as unknown — never as "no catalyst." The cache is normally warmed by
// whichever request already calls getEarningsCalendar/getCatalystCalendar
// (the /catalysts route, options-watch ranking); this also kicks a rate-
// limited background refresh so INS isn't starved indefinitely if nothing
// else has warmed it yet.

let lastBackgroundRefreshAttempt = 0;
const BACKGROUND_REFRESH_COOLDOWN_MS = 60 * 1000;

function warmEarningsCacheInBackground(): void {
  const isStale = !earningsCache || Date.now() - earningsCache.fetchedAt >= CACHE_TTL_MS;
  if (!isStale) return;
  if (Date.now() - lastBackgroundRefreshAttempt < BACKGROUND_REFRESH_COOLDOWN_MS) return;
  lastBackgroundRefreshAttempt = Date.now();
  void getEarningsCalendar(15).catch(() => {});
}

// Approximates trading days between two dates by counting weekdays — no
// market-holiday calendar, which is fine for a "how close" proximity score
// rather than a precise settlement calculation.
function tradingDaysBetween(from: Date, toDateStr: string): number | undefined {
  const to = new Date(`${toDateStr}T00:00:00Z`);
  if (isNaN(to.getTime())) return undefined;
  const fromUTC = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUTC   = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const dir = toUTC >= fromUTC ? 1 : -1;
  let cursor = fromUTC;
  let count = 0;
  while (cursor !== toUTC) {
    cursor += dir * 24 * 60 * 60 * 1000;
    const dow = new Date(cursor).getUTCDay();
    if (dow !== 0 && dow !== 6) count += dir;
  }
  return count;
}

// Trading days until `ticker`'s next known earnings date, or undefined if
// none is cached. Callers (INS) must treat undefined as "unknown," not as
// "no catalyst" (0) or something to silently ignore.
export function getTradingDaysToNextEarnings(ticker: string): number | undefined {
  warmEarningsCacheInBackground();
  const match = (earningsCache?.events ?? []).find(e => e.ticker === ticker);
  if (!match) return undefined;
  return tradingDaysBetween(new Date(), match.date);
}

// ── Market-wide macro catalysts ─────────────────────────────────────────────────
// Finnhub's free tier doesn't expose a macro/economic calendar, so this list is
// maintained by hand rather than fetched. UPDATE THIS LIST periodically (BLS and
// the Fed both publish their release schedules months in advance) — treat it as
// a config file, not a live feed. Dates are illustrative placeholders; replace
// with the real published schedule for your current window.

export interface MacroEvent {
  name: string;
  date: string; // YYYY-MM-DD
  category: "inflation" | "fed" | "employment" | "other";
}

export const MACRO_EVENTS: MacroEvent[] = [
  // Example shape — replace with the real dates from bls.gov and
  // federalreserve.gov before relying on this in production.
  // { name: "CPI report",     date: "2026-08-13", category: "inflation" },
  // { name: "FOMC minutes",   date: "2026-08-19", category: "fed" },
  // { name: "Jobs report",    date: "2026-09-04", category: "employment" },
];

export function getUpcomingMacroEvents(daysAhead = 14): MacroEvent[] {
  const now = fmtDate(new Date());
  const cutoff = fmtDate(new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000));
  return MACRO_EVENTS
    .filter(e => e.date >= now && e.date <= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface CatalystCalendar {
  macro: MacroEvent[];
  earnings: EarningsEvent[];
}

export async function getCatalystCalendar(daysAhead = 10): Promise<CatalystCalendar> {
  const [earnings, macro] = await Promise.all([
    getEarningsCalendar(daysAhead),
    Promise.resolve(getUpcomingMacroEvents(daysAhead)),
  ]);
  return { macro, earnings };
}
