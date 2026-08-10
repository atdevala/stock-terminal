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
