import type { StockScore } from "./scores";
import type { BreakoutCandidate, OptionsCandidate } from "./breakout";
import { EXTENDED_LABEL_SUFFIX, LOW_QUALITY_LABEL } from "./signal-consistency";
import { logger } from "./logger";

// ── Phase 3 safety net ────────────────────────────────────────────────────────
// Phase 2 (lib/signal-consistency.ts) makes it structurally hard for a stock
// to land in contradictory places, by having every feature read the same
// isExtended/passesQualityFloor flags instead of re-deriving their own. This
// does NOT guarantee it stays that way — a future feature that adds its own
// threshold instead of importing the shared one reproduces exactly the bug
// this whole pass fixed. This check doesn't prevent that; it makes it visible
// the moment it happens, in a log, instead of a user noticing a stock up 30%
// still labeled a fresh opportunity.
//
// Called once per /options-watch request (see routes/stocks.ts) — the one
// route that naturally has both the options list and the full scores array
// in hand already, without an extra network call (breakout candidates are
// cheap to re-derive synchronously; only the options side needed the async
// earnings-calendar fetch that route already does).

export interface ConsistencyIssue {
  ticker: string;
  issue: string;
}

const ACCUMULATE_SIGNAL_SCORE_MIN = 65; // must match AlphaScannerPage.tsx's "accumulate" filter
const ACCUMULATE_FBRS_MAX = 70;

export function checkSignalConsistency(
  allScores: StockScore[],
  breakoutCandidates: BreakoutCandidate[],
  optionsCandidates: OptionsCandidate[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const breakoutTickers = new Set(breakoutCandidates.map(c => c.ticker));
  const putTickers = new Set(optionsCandidates.filter(c => c.direction === "Put Candidate").map(c => c.ticker));
  const callTickers = new Set(optionsCandidates.filter(c => c.direction === "Call Candidate").map(c => c.ticker));

  for (const score of allScores) {
    const isAccumulate = score.signalScore >= ACCUMULATE_SIGNAL_SCORE_MIN
      && score.fbrs <= ACCUMULATE_FBRS_MAX
      && score.passesQualityFloor
      && !score.isExtended;

    // Defense-in-depth: these should be structurally impossible after the
    // Phase 2 gates, but that's exactly the assumption worth re-checking.
    if (breakoutTickers.has(score.ticker) && !score.passesQualityFloor) {
      issues.push({ ticker: score.ticker, issue: "quality-gated (fails VQS floor) but present in Top Breakout Candidates" });
    }
    if (breakoutTickers.has(score.ticker) && score.isExtended) {
      issues.push({ ticker: score.ticker, issue: "currently extended (RSI, 50-day-MA distance, or same-day % — see signal-consistency.ts) but present in Top Breakout Candidates" });
    }

    // Consolidation-pass addition: does the LABEL a user actually sees agree
    // with the gate flags that supposedly drove it? These two checks catch a
    // different failure mode than the cross-feature ones above — not "is this
    // stock in two lists that disagree," but "is scores.ts's own label
    // computation internally consistent with its own isExtended/
    // passesQualityFloor flags on this same object." Structurally shouldn't
    // be possible after this pass (see scores.ts's signalLabel computation),
    // which is exactly why it's worth checking, not assuming.
    if (!score.passesQualityFloor && score.signalLabel !== LOW_QUALITY_LABEL) {
      issues.push({ ticker: score.ticker, issue: `fails VQS quality floor but signalLabel is "${score.signalLabel}", not "${LOW_QUALITY_LABEL}"` });
    }
    if (score.isExtended && score.passesQualityFloor && !score.signalLabel.endsWith(EXTENDED_LABEL_SUFFIX)) {
      issues.push({ ticker: score.ticker, issue: `isExtended is true but signalLabel ("${score.signalLabel}") doesn't carry the "${EXTENDED_LABEL_SUFFIX.trim()}" qualifier` });
    }

    // The direct cross-feature contradiction this whole investigation started
    // from: a stock the system is bullish on in one place and bearish on in
    // another, at the same moment.
    if (putTickers.has(score.ticker) && breakoutTickers.has(score.ticker)) {
      issues.push({ ticker: score.ticker, issue: "Put Candidate in Options Setups AND a Top Breakout Candidate" });
    }
    if (putTickers.has(score.ticker) && isAccumulate) {
      issues.push({ ticker: score.ticker, issue: "Put Candidate in Options Setups AND in the Whole Market Accumulate bucket" });
    }
    // Not hard-gated (a reversal thesis on a low-quality name is a real,
    // distinct strategy — not the same claim as "top pick"), but still worth
    // surfacing: a Call Candidate on a stock the rest of the system considers
    // structurally broken is a real tension worth a human glancing at.
    if (callTickers.has(score.ticker) && !score.passesQualityFloor) {
      issues.push({ ticker: score.ticker, issue: "Call Candidate in Options Setups but fails the VQS quality floor" });
    }
  }

  if (issues.length > 0) {
    logger.warn({ issues }, `Signal consistency check found ${issues.length} contradiction(s)`);
  }

  return issues;
}
