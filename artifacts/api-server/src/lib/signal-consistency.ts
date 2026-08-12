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

export interface SignalConsistency {
  /** RSI >= RSI_OVERBOUGHT. False (not "unknown") when RSI isn't loaded yet — callers that need to distinguish "known safe" from "no data" should check rsi presence separately. */
  isExtended: boolean;
  /** RSI <= RSI_OVERSOLD. */
  isOversold: boolean;
  /** VQS >= VQS_QUALITY_FLOOR. */
  passesQualityFloor: boolean;
  /** passesQualityFloor && !isExtended — the single flag buy-side ranking/candidate features should hard-exclude on. */
  eligibleForBuySide: boolean;
}

export function evaluateSignalConsistency(vqs: number, rsi: number | undefined): SignalConsistency {
  const isExtended = rsi !== undefined && rsi >= RSI_OVERBOUGHT;
  const isOversold = rsi !== undefined && rsi <= RSI_OVERSOLD;
  const passesQualityFloor = vqs >= VQS_QUALITY_FLOOR;
  return {
    isExtended,
    isOversold,
    passesQualityFloor,
    eligibleForBuySide: passesQualityFloor && !isExtended,
  };
}
