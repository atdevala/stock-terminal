import { finnhubGet, getAllQuotes, getMarketStatus } from "./finnhub";
import { TICKER_TO_COMPANY } from "./stocks-data";
import { logger } from "./logger";

// ═════════════════════════════════════════════════════════════════════════════
// "WHY IS THIS STOCK MOVING" NEWS FEED
// ═════════════════════════════════════════════════════════════════════════════
//
// Deliberately template-based, NOT AI-generated. Confirmed: this file makes
// zero calls to Anthropic or any other LLM — the only external calls here are
// to Finnhub's existing company-news REST endpoint, via the same shared
// finnhubGet() rate-limited queue every other fetch in this codebase uses.
// Direction (higher/lower) comes from real quote data already in memory; the
// "why" comes verbatim (lightly cleaned for grammar — see cleanHeadline) from
// the news headline itself, never from a model's interpretation of it. This
// is a separate, self-contained feature — it doesn't touch scores.ts,
// breakout.ts, or any of the signal-consistency work. If a future pass wants
// an AI-written version of these blurbs, that's a distinct option to
// evaluate on its own — not something to fold into this file.

export interface NewsBlurb {
  ticker: string;
  company: string;
  blurb: string;
  headline: string;
  source: string;
  url: string;
  changePercent: number;
  /** Unix seconds, from Finnhub — when the article was published, not when this blurb was generated. */
  newsTimestamp: number;
}

interface NewsArticle {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number; // unix seconds
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Simple in-memory TTL cache (same pattern as macd-service.ts's macdCache) —
// this is a secondary, ancillary feature outside the main scoring pipeline,
// not something that needs to survive a restart via the persisted disk cache
// ext-cache.ts uses for the core fundamentals/candles/profile data. 90 minutes
// splits the difference the spec asked for (1-2h): news is time-sensitive
// enough that an hour-old cache could miss a fresh headline, but doesn't need
// to be real-time-real-time either.
const NEWS_CACHE_TTL_MS = 90 * 60 * 1000;
const newsCache = new Map<string, { fetchedAt: number; articles: NewsArticle[] }>();

// ── Thresholds — chosen and documented, not arbitrary ────────────────────────
//
// NOTABLE_MOVE_PCT = 5: only tickers moving at least this much get a news
// lookup at all. This universe's names routinely see 5-10% single-day swings
// that are ordinary noise, not "notable" (see signal-consistency.ts's
// SAME_DAY_MOVE_PCT=15 reasoning for the same observation about this
// specific watchlist) — 5% is set lower than that 15% "extended" bar on
// purpose, since "is there a story worth asking about" is a lower bar than
// "is this stock overbought." It's also a real API-budget decision: fetching
// news for the whole ~150-ticker universe every cache cycle would be ~150
// extra Finnhub calls; filtering to movers first means only a handful of
// names get a news lookup on a typical day.
const NOTABLE_MOVE_PCT = 5;

// NEWS_RECENCY_MS = 24h: a three-day-old headline doesn't explain today's
// price action, even if it's the most recent article Finnhub has for that
// ticker. Matches the spec's own suggested window.
const NEWS_RECENCY_MS = 24 * 60 * 60 * 1000;

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Exported for a temporary debug route only (see routes/news.ts) — the real
// call path is getMovingStockNews() below.
export async function fetchCompanyNews(ticker: string): Promise<NewsArticle[]> {
  const cached = newsCache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_TTL_MS) {
    return cached.articles;
  }
  try {
    // 2-day lookback window gives headroom over the 24h recency filter below
    // (a headline from 25h ago shouldn't disappear just because "yesterday"
    // rolled over between the fetch and the recency check).
    const to = new Date();
    const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const data = await finnhubGet(
      `/company-news?symbol=${ticker}&from=${fmtDate(from)}&to=${fmtDate(to)}`,
    ) as Array<Record<string, unknown>>;

    const articles: NewsArticle[] = (Array.isArray(data) ? data : [])
      .map(a => ({
        headline: String(a["headline"] ?? "").trim(),
        summary:  String(a["summary"]  ?? "").trim(),
        source:   String(a["source"]   ?? "").trim(),
        url:      String(a["url"]      ?? "").trim(),
        datetime: Number(a["datetime"] ?? 0),
      }))
      .filter(a => a.headline && a.datetime > 0);

    newsCache.set(ticker, { fetchedAt: Date.now(), articles });
    return articles;
  } catch (err) {
    logger.warn({ ticker, err }, "Company news fetch failed");
    return cached?.articles ?? [];
  }
}

// Light grammar cleanup ONLY — no rewriting, no interpretation, no
// summarizing. Strips a trailing "(EXCHANGE: TICKER)" suffix some sources
// append and trailing punctuation so the headline reads naturally after
// "... after {headline}.". Lowercases the first letter so it reads as a
// clause continuing the sentence, unless the headline starts with what looks
// like an acronym or proper noun (e.g. "FDA approves...", "Nvidia unveils...")
// — a rough heuristic (all-caps first word, or already lowercase), not a
// grammar engine.
function cleanHeadline(headline: string): string {
  let h = headline.trim();
  h = h.replace(/\s*\([A-Za-z]+:\s*[A-Za-z.]+\)\s*$/, "");
  h = h.replace(/[.!?]+$/, "");
  if (h.length > 1 && /^[A-Z][a-z]/.test(h)) {
    h = h[0]!.toLowerCase() + h.slice(1);
  }
  return h;
}

function sessionWord(session: string): string {
  if (session === "pre-market")  return "premarket";
  if (session === "post-market") return "after hours";
  return "today";
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getMovingStockNews(): Promise<NewsBlurb[]> {
  const movers = getAllQuotes().filter(q => Math.abs(q.changePercent) >= NOTABLE_MOVE_PCT);
  const sess = sessionWord(getMarketStatus().session);
  const cutoffSeconds = (Date.now() - NEWS_RECENCY_MS) / 1000;

  // Real Finnhub calls are still serialized by the shared rate-limit queue
  // (finnhubGet → enqueue) no matter how many of these run concurrently —
  // see finnhub.ts's runBatched comment. `movers` is typically a handful of
  // tickers on any given day, so a plain Promise.all is fine here without
  // needing that helper.
  const results = await Promise.all(movers.map(async q => {
    const articles = await fetchCompanyNews(q.ticker);
    const recent = articles
      .filter(a => a.datetime >= cutoffSeconds)
      .sort((a, b) => b.datetime - a.datetime);
    if (recent.length === 0) return null;

    const top = recent[0]!;
    const reason = cleanHeadline(top.headline || top.summary);
    if (!reason) return null;

    const direction = q.changePercent >= 0 ? "higher" : "lower";
    const blurb: NewsBlurb = {
      ticker: q.ticker,
      company: TICKER_TO_COMPANY[q.ticker] ?? q.ticker,
      blurb: `${q.ticker} shares are trading ${direction} ${sess} after ${reason}.`,
      headline: top.headline,
      source: top.source,
      url: top.url,
      changePercent: q.changePercent,
      newsTimestamp: top.datetime,
    };
    return blurb;
  }));

  return results
    .filter((b): b is NewsBlurb => b !== null)
    .sort((a, b) => b.newsTimestamp - a.newsTimestamp);
}
