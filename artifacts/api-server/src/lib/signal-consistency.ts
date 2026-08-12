// ── Signal consistency: ONE shared definition of "extended" and "quality-gated" ─
//
// Root cause of a real production bug (COHR labeled "LOW QUALITY / AVOID" but
// still #3 in Top Breakout Candidates; NBIS up 29% intraday still ranked #1
// "HIGH CONVICTION" on the Whole Market page; ONDS simultaneously a top buy-side
// pick AND a Put Candidate): three features each computed their own
// independent read of "is this stock overbought," using three different
// hardcoded RSI thresholds (65 / 70 / 75), and two independent reads of
// "does this pass the fundamental floor" (VQS 30 / 40). Nothing shared logic.
//
// This module is the ONE place those checks happen now. Every feature that
// needs to know "is this stock currently extended" or "does it pass the
// quality floor" calls evaluateSignalConsistency() — it is not reimplemented
// in breakout.ts, the composite label, or anywhere else.

// ── Canonical thresholds — chosen deliberately, not averaged ─────────────────
//
// RSI_OVERBOUGHT = 70 (previously 65 in Options Setups' put classification,
// 70 in INS's RSI gate, 75 in Top Breakout Candidates' exclusion gate):
//   - 70 is the textbook Wilder RSI overbought line — the standard definition
//     any reader of "RSI 70" already has in mind, not a bespoke number that
//     needs its own justification every time it's cited.
//   - It's the value INS's gate (ins.ts) already used, built and shipped in a
//     prior pass — anchoring on the number already proven in this codebase
//     rather than introducing a fourth new one.
//   - It sits between the other two existing values, so unifying on it is a
//     moderate correction in both directions rather than a swing to either
//     extreme: Top Breakout Candidates gets modestly STRICTER (75→70 excludes
//     more already-extended names — the direction this bug report wants,
//     since a stock up 30% today should be excluded, not featured), and
//     Options Setups' put classification gets modestly LOOSER (65→70 — a
//     stock at RSI 65-69, like ONDS, no longer gets bearishly labeled while
//     every other feature still calls it a fine long — directly closing the
//     ONDS contradiction).
//   - Alternative considered: 65 (strictest, excludes the most candidates —
//     more defensive system-wide, but would leave Options Setups' behavior
//     completely unchanged and do nothing for the ONDS-class contradiction).
//     Rejected because it doesn't address the actual failure mode reported.
//
// RSI_OVERSOLD = 30 (previously 30 in INS's gate, 40 in Options Setups' call
// classification — the same class of mismatch on the other side of the band):
//   - 30 is RSI_OVERBOUGHT's textbook mirror (the standard 30/70 band), and
//     matches INS's gate already.
//
// VQS_QUALITY_FLOOR = 40 (previously 40 in the composite label's "LOW QUALITY
// / AVOID" trigger and in CSOS's fundamental-floor penalty, but 30 in Top
// Breakout Candidates' own eligibility gate):
//   - 40 already governs THREE other places in this codebase (csosLabelText's
//     "LOW QUALITY / AVOID" branch, calculateCSOS's fundamental-floor
//     penalty, and the frontend's fallback reason text all cite VQS<40) — 30
//     was the outlier, used only in breakout.ts. Adopting 40 aligns with the
//     already-dominant existing definition instead of picking a new number.
//   - This is also the direction that actually fixes the reported bug: COHR
//     (VQS 37) sat exactly between 30 and 40 — labeled avoid-worthy under the
//     40 definition, but passing breakout.ts's looser 30 gate. Adopting 40
//     everywhere closes that exact gap.

export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;
export const VQS_QUALITY_FLOOR = 40;

// The one shared chase-risk qualifier signalLabel appends (not replaces) when
// isExtended is true (see scores.ts) — exported so consistency-check.ts can
// verify the label a stock actually shows matches what its own isExtended
// flag says it should, without hardcoding a second copy of this string to
// drift out of sync with the one scores.ts actually uses.
export const EXTENDED_LABEL_SUFFIX = " — already extended today";

export const LOW_QUALITY_LABEL = "LOW QUALITY / AVOID";

// ── Extended-detection robustness ────────────────────────────────────────────
// RSI(14) alone can fail to flag a huge single-day move if the prior 13 days
// offset it — Wilder smoothing means one dramatic day is diluted across a
// two-week average. This is what happened with NBIS: up ~30% in a session,
// RSI stayed in the low-to-mid 60s because the two weeks before that move
// were flat-to-down, keeping the smoothed average well under the RSI_OVERBOUGHT
// line. RSI is still the primary check (it's the standard, well-understood
// "is this stretched relative to its own range" read), but "extended" is now
// an OR across three independent, cheaper-to-game-proof reads — any ONE of
// them firing is enough, since each is measuring the same underlying idea
// (has this stock already made its move) from a different angle:
//
//   1. RSI >= RSI_OVERBOUGHT (70) — the standard multi-day read.
//   2. Price >= MA50_EXTENSION_PCT (25%) above its own 50-day moving average.
//      Chosen because it's a magnitude check independent of RSI's smoothing:
//      a stock doesn't get 25%+ above its own 50-day average without a real,
//      large move having already happened, regardless of how the prior two
//      weeks shaped RSI's average. 25% is deliberately a high bar — comfortably
//      above normal single-name volatility in an ordinary uptrend (which
//      routinely runs 5-15% above its 50-day average without being "extended"
//      in the chase-risk sense) — so this only fires for genuinely large
//      dislocations, not routine strength.
//   3. Same-day change >= SAME_DAY_MOVE_PCT (15%). The most direct read of
//      all: a stock up 15%+ in a single session has, by definition, already
//      made "the move" today — no multi-day indicator needs to confirm that.
//      15% is picked as large enough that it's unambiguous even accounting
//      for this universe's characteristically volatile small/mid-caps
//      (quantum computing, biotech, pre-revenue space names routinely see
//      5-10% single-day swings that are NOT "the move already happened,"
//      just normal noise for these names) — this catches NBIS's ~30% day
//      immediately, on day one, without waiting for RSI or the 50-day
//      average to catch up.
export const MA50_EXTENSION_PCT = 0.25;
export const SAME_DAY_MOVE_PCT = 15;

export interface SignalConsistencyInputs {
  vqs: number;
  rsi: number | undefined;
  /** Current live price. Combined with ma50 for the MA50_EXTENSION_PCT check. */
  price?: number;
  ma50?: number;
  /** Today's % change (e.g. 30 for +30%), for the SAME_DAY_MOVE_PCT check. */
  changePercent?: number;
}

export interface SignalConsistency {
  /** True if RSI>=RSI_OVERBOUGHT, OR price is MA50_EXTENSION_PCT+ above its 50-day MA, OR today's change is SAME_DAY_MOVE_PCT+ — see the reasoning above each threshold. False (not "unknown") when no input is available to evaluate any condition — callers that need to distinguish "known safe" from "no data" should check rsi/price presence separately. */
  isExtended: boolean;
  /** RSI <= RSI_OVERSOLD. */
  isOversold: boolean;
  /** VQS >= VQS_QUALITY_FLOOR. */
  passesQualityFloor: boolean;
  /** passesQualityFloor && !isExtended — the single flag buy-side ranking/candidate features should hard-exclude on. */
  eligibleForBuySide: boolean;
}

export function evaluateSignalConsistency(inputs: SignalConsistencyInputs): SignalConsistency {
  const { vqs, rsi, price, ma50, changePercent } = inputs;

  const rsiExtended = rsi !== undefined && rsi >= RSI_OVERBOUGHT;
  const ma50Extended = price !== undefined && ma50 !== undefined && ma50 > 0
    && (price - ma50) / ma50 >= MA50_EXTENSION_PCT;
  const sameDayExtended = changePercent !== undefined && changePercent >= SAME_DAY_MOVE_PCT;

  const isExtended = rsiExtended || ma50Extended || sameDayExtended;
  const isOversold = rsi !== undefined && rsi <= RSI_OVERSOLD;
  const passesQualityFloor = vqs >= VQS_QUALITY_FLOOR;
  return {
    isExtended,
    isOversold,
    passesQualityFloor,
    eligibleForBuySide: passesQualityFloor && !isExtended,
  };
}
