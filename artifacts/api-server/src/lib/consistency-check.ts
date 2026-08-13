import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// Whole-Market-ranking follow-up (2026-08-12): the Breakout/Options gates
// above didn't cover the Whole Market page's own ranked order, which sorted
// purely by raw signalScore — a stock could fail the quality floor AND be
// extended and still rank #1 (confirmed live: SDGR, "LOW QUALITY / AVOID",
// RSI 74, ranked #1). AlphaScannerPage.tsx's sortRows() now demotes
// gate-failing stocks below every gate-passing one instead of sorting on
// signalScore alone. That ranking is computed CLIENT-SIDE from the same
// /api/scores payload this function already receives, so it's mirrored here
// rather than imported — keep this in sync by hand if sortRows() changes.
const WHOLE_MARKET_TOP_N = 20;

function computeWholeMarketRanking(allScores: StockScore[]): StockScore[] {
  return [...allScores].sort((a, b) => {
    const aEligible = a.passesQualityFloor && !a.isExtended;
    const bEligible = b.passesQualityFloor && !b.isExtended;
    if (aEligible !== bEligible) return aEligible ? -1 : 1;
    return b.signalScore - a.signalScore;
  });
}

// ── Persisted report ──────────────────────────────────────────────────────────
// Previously this check only ever logged via logger.warn — real findings, but
// gone the moment Render's ephemeral log stream rotated, with no way to
// answer "what did the last audit find" after the fact. Writes the latest
// run's full result (not just failures) to the same persistent Disk the
// ext-cache/signal-history files already use, so /api/consistency-report can
// serve a real answer instead of "check the logs."
const DATA_DIR = process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const REPORT_FILE = path.join(DATA_DIR, "consistency-report.json");

export interface ConsistencyReport {
  ts: number;
  scoredUniverseSize: number;
  breakoutCandidateCount: number;
  optionsCandidateCount: number;
  issueCount: number;
  issues: ConsistencyIssue[];
}

function saveReport(report: ConsistencyReport): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report), "utf-8");
  } catch (err) {
    logger.warn({ err }, "Could not save consistency report to disk");
  }
}

export function getLastConsistencyReport(): ConsistencyReport | null {
  try {
    if (!fs.existsSync(REPORT_FILE)) return null;
    return JSON.parse(fs.readFileSync(REPORT_FILE, "utf-8")) as ConsistencyReport;
  } catch (err) {
    logger.warn({ err }, "Could not read consistency report from disk");
    return null;
  }
}

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

  // Whole-Market-ranking check: does any gate-failing stock still land in the
  // top N ranked positions? After the sortRows() fix this should only ever
  // happen if fewer than WHOLE_MARKET_TOP_N stocks in the whole universe
  // pass both gates (a thin-eligible-set edge case, not a bug) — everything
  // else would mean the frontend's ranking and this mirror have drifted out
  // of sync, which is exactly the kind of silent regression this is here to
  // catch.
  const wholeMarketRanking = computeWholeMarketRanking(allScores);
  wholeMarketRanking.slice(0, WHOLE_MARKET_TOP_N).forEach((score, i) => {
    if (!score.passesQualityFloor || score.isExtended) {
      const reasons = [
        !score.passesQualityFloor ? "fails the VQS quality floor" : null,
        score.isExtended ? "is currently extended" : null,
      ].filter(Boolean).join(" and ");
      issues.push({ ticker: score.ticker, issue: `ranked #${i + 1} on the Whole Market page (top ${WHOLE_MARKET_TOP_N}) but ${reasons}` });
    }
  });

  if (issues.length > 0) {
    logger.warn({ issues }, `Signal consistency check found ${issues.length} contradiction(s)`);
  }

  saveReport({
    ts: Date.now(),
    scoredUniverseSize: allScores.length,
    breakoutCandidateCount: breakoutCandidates.length,
    optionsCandidateCount: optionsCandidates.length,
    issueCount: issues.length,
    issues,
  });

  return issues;
}
