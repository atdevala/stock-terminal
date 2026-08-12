import type { StockScore } from "./scores";
import type { ExtendedMetrics, QuoteData } from "./finnhub";
import { appendLivePrice } from "./scores";
import { CATEGORIES } from "./stocks-data";
import { getEarningsCalendar } from "./catalysts";
import { RSI_OVERBOUGHT } from "./signal-consistency";

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

const COMPANY_BY_TICKER: Map<string, string> = new Map(
  CATEGORIES.flatMap(c => c.stocks).map(s => [s.ticker, s.company]),
);

// ═════════════════════════════════════════════════════════════════════════════
// BREAKOUT READINESS — "which stocks are most likely to break out right now"
// ═════════════════════════════════════════════════════════════════════════════
//
// This is a NEW derived value (plain English name, not another 3-letter code),
// built the same way BPS/CSOS were: documented weights over already-computed
// primitives, no invented data.
//
// Eligibility gate — a stock isn't even considered unless ALL of these hold:
//   - INS is present (real leading-momentum signal, not a missing-data default)
//   - RSI is present (must have real price history)
//   - passesQualityFloor (shared definition, lib/signal-consistency.ts: VQS
//     >= 40) — a pure meme spike on a broken business doesn't qualify just
//     because it's moving. Was this file's own `vqs < 30` check; that looser,
//     independently-chosen threshold is exactly why a stock already labeled
//     "LOW QUALITY / AVOID" elsewhere (VQS 30-39) could still show up here —
//     a real production bug, fixed by reading the same shared flag everything
//     else reads instead of re-deriving a different number.
//   - !isExtended (shared definition: RSI >= 70) — can't already be
//     overbought; "room to run" is part of the definition, not a bonus. Was
//     this file's own `rsi >= 75` check — looser than the shared 70, which
//     meant a stock already flagged "EXTENDED" by the RSI gate elsewhere
//     could still pass here in the 70-74.9 RSI band.
//
// Weighted score (0-100) over stocks that pass the gate:
//   45% INS   — the leading momentum-inflection signal. This is the single
//               biggest driver on purpose: breakout candidates are defined by
//               "is momentum inflecting right now," and INS is built exactly
//               to answer that.
//   30% ACS   — accumulation confidence. Requires REAL institutional buying
//               behind the move, not just a hype-driven price spike.
//   25% RoomToRun — derived from RSI. 100 at RSI<=50, tapering linearly to 0
//               at RSI_OVERBOUGHT (the gate already excludes at/above that).
//               Rewards setups that haven't already run most of their move.
//
// Then two adjustments, both tracing to real computed numbers:
//   Quality gate:  avg(VQS, LQS) < 35  → ×0.75 penalty (junk discount)
//                  avg(VQS, LQS) >= 65 → ×1.05 bonus (quality confirms the move)
//   FBRS penalty:  score -= max(0, FBRS - 60) * 0.4 (hype/false-breakout risk
//                  pulls the score down; clean setups (FBRS <= 60) are untouched)

export interface BreakoutCandidate {
  ticker: string;
  company: string;
  breakoutReadiness: number;
  reasonLabel: string; // the existing plain-English signalLabel, for a consistent vocabulary
  drivers: {
    ins: number;
    acs: number;
    vqs: number;
    lqs?: number;
    rsi?: number;
    fbrs: number;
  };
}

export function computeBreakoutReadiness(score: StockScore): number | null {
  const ins = score.ins;
  const rsi = score.rsi;
  if (ins === undefined) return null;
  if (rsi === undefined) return null;
  if (!score.passesQualityFloor) return null;
  if (score.isExtended) return null;

  const taperSlope = 100 / (RSI_OVERBOUGHT - 50);
  const roomToRun = clamp(100 - Math.max(0, rsi - 50) * taperSlope, 0, 100); // 100 at <=50, 0 at RSI_OVERBOUGHT
  let raw = 0.45 * ins + 0.30 * score.acs + 0.25 * roomToRun;

  const qualityFloor = score.lqs !== undefined ? (score.vqs + score.lqs) / 2 : score.vqs;
  if (qualityFloor < 35) raw *= 0.75;
  else if (qualityFloor >= 65) raw *= 1.05;

  raw -= Math.max(0, score.fbrs - 60) * 0.4;

  return Math.round(clamp(raw, 0, 100));
}

export function rankBreakoutCandidates(scores: StockScore[], limit = 10): BreakoutCandidate[] {
  return scores
    .map(score => ({ score, readiness: computeBreakoutReadiness(score) }))
    .filter((x): x is { score: StockScore; readiness: number } => x.readiness !== null)
    .sort((a, b) => b.readiness - a.readiness)
    .slice(0, limit)
    .map(({ score, readiness }) => ({
      ticker: score.ticker,
      company: COMPANY_BY_TICKER.get(score.ticker) ?? score.ticker,
      breakoutReadiness: readiness,
      reasonLabel: score.signalLabel,
      drivers: {
        ins: score.ins!,
        acs: score.acs,
        vqs: score.vqs,
        lqs: score.lqs,
        rsi: score.rsi,
        fbrs: score.fbrs,
      },
    }));
}

// ═════════════════════════════════════════════════════════════════════════════
// OPTIONS SETUP SCORE — "which names look like real put/call candidates"
// ═════════════════════════════════════════════════════════════════════════════
//
// Realized volatility (20-day, annualized %) computed directly from closes60d
// — nobody's price target, an actual statistic of the ticker's own recent
// closes. Combined with two other real, already-available inputs:
//   - A real upcoming earnings date (catalysts.ts / Finnhub earnings calendar
//     — not inferred, an actual scheduled event)
//   - RSI + ACS for a directional read
//
// Eligibility gate — needs at least ONE real reason to be "in play":
//   - a real earnings date within 10 days, OR
//   - realized 20D volatility > 35% annualized (already moving a lot on its own)
//
// Directional read (must have one, or the stock isn't shown here at all —
// "no strong directional read" means it's not a good options-setup candidate
// by this heuristic's own definition). Uses the shared isExtended/isOversold
// flags (lib/signal-consistency.ts) instead of this file's own separate RSI
// thresholds — this file used to check RSI >= 65 / <= 40 independently of
// the RSI >= 70 / <= 30 the rest of the system uses, which is exactly how a
// stock (e.g. RSI 65-69) could get called a bearish "Put Candidate" here
// while every other feature still read it as a fine long:
//   - isExtended  → "Put Candidate"  (RSI >= 70 — the case for a directional
//     put or a covered-call-style setup)
//   - isOversold AND ACS >= 55 → "Call Candidate" (RSI <= 30, but with real
//     accumulation underneath — the case for a reversal-higher setup)
//
// Ranking — Options Setup Score = realizedVol20d × (1 + earningsProximityBonus)
//   earnings in <=3 days:  +50%
//   earnings in <=7 days:  +25%
//   earnings in <=10 days / none: +0%
// Higher = more premium/movement potential and a nearer reason for it.

export interface OptionsCandidate {
  ticker: string;
  company: string;
  direction: "Call Candidate" | "Put Candidate";
  optionsSetupScore: number;
  realizedVolatility20d: number;
  nextEarnings: { date: string; daysAway: number } | null;
  closes60d: number[];
  drivers: { rsi: number; acs: number };
}

export function computeRealizedVolatility20d(closes: number[]): number | undefined {
  if (closes.length < 21) return undefined;
  const recent = closes.slice(-21);
  const rets: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1]!;
    if (prev > 0) rets.push((recent[i]! - prev) / prev);
  }
  if (rets.length < 2) return undefined;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
  const dailyStd = Math.sqrt(variance);
  return dailyStd * Math.sqrt(252) * 100; // annualized, as a percentage
}

function daysBetween(fromISODate: string, toISODate: string): number {
  const from = new Date(fromISODate + "T00:00:00Z").getTime();
  const to = new Date(toISODate + "T00:00:00Z").getTime();
  return Math.round((to - from) / 86_400_000);
}

export async function rankOptionsCandidates(
  scores: StockScore[],
  extByTicker: Map<string, ExtendedMetrics>,
  quotesByTicker: Map<string, QuoteData>,
  limit = 5,
): Promise<OptionsCandidate[]> {
  const earnings = await getEarningsCalendar(10);
  const earningsByTicker = new Map(earnings.map(e => [e.ticker, e]));
  const today = new Date().toISOString().slice(0, 10);

  const candidates: OptionsCandidate[] = [];

  for (const score of scores) {
    const ext = extByTicker.get(score.ticker);
    // Appends the live quote price (see appendLivePrice in scores.ts) — a
    // stock that already moved a lot TODAY has already realized that
    // volatility; holding it back until tomorrow's candle would understate
    // an already-materialized move for a ranking whose whole point is
    // "which names are moving right now."
    const currentPrice = quotesByTicker.get(score.ticker)?.price ?? 0;
    const closes = appendLivePrice(ext?.closes60d, currentPrice);
    const vol = computeRealizedVolatility20d(closes);
    if (vol === undefined) continue;

    const earningsEvent = earningsByTicker.get(score.ticker);
    const daysAway = earningsEvent ? daysBetween(today, earningsEvent.date) : undefined;
    const hasCatalyst = daysAway !== undefined && daysAway >= 0 && daysAway <= 10;

    if (!hasCatalyst && vol < 35) continue; // no real reason this name is "in play" right now

    const rsi = score.rsi;
    if (rsi === undefined) continue;

    let direction: "Call Candidate" | "Put Candidate" | null = null;
    if (score.isExtended) direction = "Put Candidate";
    else if (score.isOversold && score.acs >= 55) direction = "Call Candidate";
    if (!direction) continue; // no strong directional read — not a candidate here

    const earningsBonus = daysAway === undefined ? 0 : daysAway <= 3 ? 0.5 : daysAway <= 7 ? 0.25 : 0;

    candidates.push({
      ticker: score.ticker,
      company: COMPANY_BY_TICKER.get(score.ticker) ?? score.ticker,
      direction,
      optionsSetupScore: Math.round(vol * (1 + earningsBonus)),
      realizedVolatility20d: Math.round(vol * 10) / 10,
      nextEarnings: earningsEvent && daysAway !== undefined ? { date: earningsEvent.date, daysAway } : null,
      closes60d: closes,
      drivers: { rsi, acs: score.acs },
    });
  }

  return candidates
    .sort((a, b) => b.optionsSetupScore - a.optionsSetupScore)
    .slice(0, limit);
}
