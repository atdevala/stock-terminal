import type { ExtendedMetrics } from "./finnhub";
import { CATEGORIES } from "./stocks-data";

// ── Sector-blindness fix, step 2: peer-group resolution + PE percentiles ─────
//
// VQS's valuation score used to compare every ticker's PE against fixed
// global thresholds (a semiconductor at PE 30 and a utility at PE 30 scored
// identically). Step 1 captured Finnhub's real industry classification onto
// ExtendedMetrics.industry. This file resolves each ticker to the best
// available PEER GROUP for a relative (percentile-based) valuation
// comparison, and computes those percentiles once per scoring pass.

// ── Ticker → CATEGORIES name lookup (built once, at module load) ────────────
// CATEGORIES (stocks-data.ts) is hand-curated and doesn't have Finnhub's
// grab-bag problem — it already separates Quantum Computing from generic
// tech, for example. Used as the fallback peer group when Finnhub's industry
// value is missing or denylisted below.
const TICKER_TO_CATEGORY = new Map<string, string>();
for (const cat of CATEGORIES) {
  for (const stock of cat.stocks) {
    TICKER_TO_CATEGORY.set(stock.ticker, cat.name);
  }
}

// ── Denylist: Finnhub industry values confirmed to be grab-bags ─────────────
// Confirmed by pulling the REAL ticker membership of each bucket via the
// /api/debug/industries diagnostic and inspecting it manually — not assumed.
// Comparing PE within a grab-bag would reproduce the sector-blindness bug
// one level less coarse than the old global-threshold method, so these fall
// back to the hand-curated CATEGORIES grouping instead (see resolvePeerGroup).
const INDUSTRY_DENYLIST = new Set<string>([
  // Mixes quantum-computing hardware (IONQ, QBTS, QUBT, ARQQ) with bitcoin
  // miners (MARA, RIOT, CLSK — commodity/power-cost-driven, not SaaS-like)
  // and mainstream enterprise SaaS (MSFT, SNOW, DDOG, CRWD, MDB, ...). These
  // do not share remotely similar valuation dynamics.
  "Technology",
  // Mixes LiDAR/photonics startups (AEVA, OUST, COHR, IPGP, FARO) with
  // century-old diversified industrial conglomerates (ETN, EMR, HUBB) and
  // pre-revenue speculative nuclear-microreactor plays (SMR, NNE). Just as
  // incoherent as "Technology" above.
  "Electrical Equipment",
]);

/**
 * Resolves the peer group key to use for a ticker's relative valuation
 * comparison. Finnhub's industry is used directly when it's present and not
 * a known grab-bag; otherwise falls back to the ticker's CATEGORIES name.
 */
export function resolvePeerGroup(ticker: string, industry: string | undefined): string {
  if (industry && industry.trim() !== "" && !INDUSTRY_DENYLIST.has(industry)) {
    return industry;
  }
  return TICKER_TO_CATEGORY.get(ticker) ?? "Unknown";
}

// A percentile computed from fewer than this many peers is unreliable — with
// e.g. 2 members, one ticker is mechanically 0th or 100th percentile
// regardless of how close their actual PEs are. 5 is a low bar (keeps most
// watchlist-sized peer groups usable) while still excluding degenerate
// groups where "percentile" wouldn't mean anything statistically.
const MIN_PEER_GROUP_SIZE = 5;

export interface PeerPercentile {
  /** 0-100. Higher = cheaper relative to peer group (same direction as the existing absolute valuation logic: lower PE scores higher). */
  percentile: number;
  peerGroup: string;
  peerGroupSize: number;
}

/**
 * Computes each ticker's PE percentile rank within its resolved peer group,
 * across the whole universe, in one pass. Tickers whose peer group has fewer
 * than MIN_PEER_GROUP_SIZE members with a valid PE (or who have no valid PE
 * themselves) map to `null` — callers must treat null as "fall back to the
 * existing absolute-threshold valuation method," not as a score of 0.
 */
export function buildPeerGroupPercentiles(
  allExtendedMetrics: ExtendedMetrics[],
): Map<string, PeerPercentile | null> {
  const result = new Map<string, PeerPercentile | null>();

  const groups = new Map<string, Array<{ ticker: string; pe: number }>>();
  for (const ext of allExtendedMetrics) {
    if (!ext.pe || ext.pe <= 0) continue; // no valid PE — handled in the fallback pass below
    const group = resolvePeerGroup(ext.ticker, ext.industry);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ ticker: ext.ticker, pe: ext.pe });
  }

  for (const [group, members] of groups) {
    if (members.length < MIN_PEER_GROUP_SIZE) {
      for (const m of members) result.set(m.ticker, null);
      continue;
    }
    // Sort cheapest (lowest PE) first. Rank 0 (cheapest) → percentile 100;
    // last rank (priciest) → percentile 0. Ties keep their sort-stable order
    // (acceptable here — this is a coarse relative signal, not a precise
    // statistical rank).
    const sorted = [...members].sort((a, b) => a.pe - b.pe);
    const n = sorted.length;
    sorted.forEach((m, i) => {
      const percentile = n > 1 ? ((n - 1 - i) / (n - 1)) * 100 : 100;
      result.set(m.ticker, { percentile, peerGroup: group, peerGroupSize: n });
    });
  }

  // Tickers with no valid PE at all also fall back to the absolute method.
  for (const ext of allExtendedMetrics) {
    if (!result.has(ext.ticker)) result.set(ext.ticker, null);
  }

  return result;
}
