import type { ExtendedMetrics } from "./finnhub";
import { appendLivePrice } from "./finnhub";

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface INSResult {
  ins: number;
  insLabel: string;
  divergenceTag: string;
  insComponents: {
    momentum: number;
    deltaVqs: number;
    volumeAccel: number;
    epsSlope: number;
    earningsProximity: number;
  };
}

export function getInsLabel(s: number): string {
  if (s >= 80) return "EXPLOSIVE EARLY BREAKOUT";
  if (s >= 65) return "EARLY MOMENTUM BUILDING";
  if (s >= 50) return "NEUTRAL / DEVELOPING";
  if (s >= 30) return "WEAK / NO EDGE";
  return "AVOID";
}

export function getDivergenceTag(ins: number, cos: number): string {
  if (ins > 70 && cos < 60) return "EARLY OPPORTUNITY";
  if (cos > 70 && ins < 50) return "LATE STAGE RISK";
  if (ins > 70 && cos > 70) return "HIGH CONVICTION";
  return "";
}

// ── A. Momentum: acceleration + relative strength + magnitude-weighted streak ─
// Consolidates the old ΔGVS proxy (computeDeltaGVS) and Narrative Momentum
// proxy (computeNarrativeMomentum) into one component. Those two overlapped
// almost entirely — both were just price momentum measured over slightly
// different windows, so 45% of INS's old weight was two views of the same
// thing. This keeps the genuinely distinct pieces from each (pace
// acceleration; relative strength vs SPY) and fixes a third real problem:
// the old green-day streak counter (`streak * 3`) was magnitude-blind — five
// days of +0.1% scored identically to five days of +2%. It's now weighted by
// the average daily return over the streak, not just its length.
//
// Internal weighting: Acceleration 40% | Relative Strength 35% | Streak 25%
function computeMomentum(closes: number[], spyCloses: number[]): number {
  const acceleration     = computeAcceleration(closes);
  const relativeStrength = computeRelativeStrength(closes, spyCloses);
  const streak           = computeStreakScore(closes);
  return clamp(0.40 * acceleration + 0.35 * relativeStrength + 0.25 * streak, 0, 100);
}

// 14-day return vs 30-day return — is the pace of the move speeding up.
// (Formerly computeDeltaGVS.)
function computeAcceleration(closes: number[]): number {
  if (closes.length < 31) return 50;
  const curr = closes[closes.length - 1]!;
  const c14  = closes[closes.length - 15]!;
  const c30  = closes[closes.length - 31]!;
  if (!c14 || !c30) return 50;
  const ret14 = (curr - c14) / c14 * 100;
  const ret30 = (curr - c30) / c30 * 100;
  return clamp(50 + (ret14 - ret30) * 2.5, 0, 100);
}

// 20D return vs SPY's 20D return over the same window — a stock up 5% while
// the market's up 6% is NOT showing real strength. (Formerly the relative-
// strength half of computeNarrativeMomentum.)
function computeRelativeStrength(closes: number[], spyCloses: number[]): number {
  if (closes.length < 20) return 50;
  const curr = closes[closes.length - 1]!;
  const c20  = closes[Math.max(0, closes.length - 21)]!;
  if (!c20) return 50;

  const ret20d = (curr - c20) / c20 * 100;
  let relStrength = ret20d;

  if (spyCloses.length >= 21) {
    const spyCurr = spyCloses[spyCloses.length - 1]!;
    const spy20   = spyCloses[Math.max(0, spyCloses.length - 21)]!;
    if (spy20 > 0) relStrength = ret20d - ((spyCurr - spy20) / spy20 * 100);
  }

  return clamp(50 + relStrength * 2, 0, 100);
}

// Magnitude-weighted up-streak: average daily return over the current run of
// green closes (max 10 days back), not just how many days it's lasted. A
// streak of five +0.1% days now scores near-neutral; five +2% days scores
// high. (Formerly the raw `streak * 3, capped 25` half of computeNarrativeMomentum.)
function computeStreakScore(closes: number[]): number {
  let streak = 0;
  let sumRet = 0;
  for (let i = closes.length - 1; i > 0 && streak < 10; i--) {
    const prev = closes[i - 1]!;
    const curr = closes[i]!;
    if (prev > 0 && curr > prev) {
      streak++;
      sumRet += (curr - prev) / prev * 100;
    } else {
      break;
    }
  }
  if (streak === 0) return 50;
  const avgDailyReturn = sumRet / streak;
  return clamp(50 + avgDailyReturn * 33, 0, 100);
}

// ── B. Delta VQS proxy: fundamental re-rating strength (0-100) ────────────────
// Revenue growth acceleration + earnings revision direction + margin quality.
function computeDeltaVQS(ext: ExtendedMetrics): number {
  let score = 0;
  const rg  = ext.revenueGrowthYoy ?? 0;
  const rgQ = ext.revenueGrowthQoQ ?? 0;
  const opM = ext.operatingMargin  ?? 0;

  if (rg > 40)       score += 30;
  else if (rg > 20)  score += 22;
  else if (rg > 10)  score += 14;
  else if (rg > 0)   score += 7;

  if (rgQ > 5)       score += 25;
  else if (rgQ > 0)  score += 15;

  if (ext.earningsRevisionsUp) score += 25;

  if (opM > 20)      score += 20;
  else if (opM > 10) score += 15;
  else if (opM > 0)  score += 10;

  return clamp(score, 0, 100);
}

// ── C. Volume Acceleration (0-100) ───────────────────────────────────────────
// Detects institutional accumulation: 5d/20d volume surge + up-volume dominance.
function computeVolumeAccel(closes: number[], volumes: number[]): number {
  if (volumes.length < 20) return 50;
  const n    = Math.min(closes.length, volumes.length);
  const cls  = closes.slice(-Math.min(n, 60));
  const vols = volumes.slice(-Math.min(n, 60));

  const vol5d  = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const vol20d = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  if (vol20d === 0) return 50;

  const ratio = vol5d / vol20d;
  // 0.5x = 0pts, 1.0x = 25pts, 2.0x = 75pts
  const ratioScore = clamp((ratio - 0.5) * 100, 0, 75);

  // Up-volume vs down-volume dominance (last 20 sessions)
  let upVol = 0, downVol = 0;
  for (let i = Math.max(1, cls.length - 20); i < cls.length; i++) {
    const v = vols[i] ?? 0;
    if ((cls[i] ?? 0) > (cls[i - 1] ?? 0)) upVol  += v;
    else                                     downVol += v;
  }
  const total   = upVol + downVol;
  const upRatio = total > 0 ? upVol / total : 0.5;
  const upScore = clamp((upRatio - 0.5) * 50, 0, 25);

  return clamp(ratioScore + upScore, 0, 100);
}

// ── D. Earnings Surprise Slope (0-100) ───────────────────────────────────────
// Rewards consistent beats and improving trend over last 4 quarters.
function computeEPSSlopeScore(surprises: number[]): number {
  if (surprises.length === 0) return 50;
  const avg   = surprises.slice(0, 4).reduce((a, b) => a + b, 0) / Math.min(surprises.length, 4);
  const trend = surprises.length >= 2 ? (surprises[0]! - surprises[1]!) : 0;
  return clamp(50 + avg * 0.5 + trend * 0.3, 0, 100);
}

// ── E. Earnings Proximity (0-100) — NEW ──────────────────────────────────────
// The one genuinely forward-looking INS input. Everything else above is
// trailing/lagging price or fundamentals data, which is why a high INS score
// has historically meant "momentum already started" rather than "about to
// start." A known earnings date within the next few trading days is a real
// forward catalyst.
//
// tradingDaysAway is undefined when the ticker has no known earnings date in
// the cached calendar window. That must NOT silently read as "no catalyst"
// (0) or get ignored — it defaults to a genuine neutral midpoint (50) so a
// missing data point can neither suppress nor inflate the score.
function computeEarningsProximity(tradingDaysAway: number | undefined): number {
  if (tradingDaysAway === undefined || tradingDaysAway < 0) return 50;
  if (tradingDaysAway <= 3) return 100;
  if (tradingDaysAway >= 15) return 0;
  return clamp(100 - ((tradingDaysAway - 3) / 12) * 100, 0, 100);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeINS(
  ext: ExtendedMetrics,
  currentPrice: number,
  cos: number,
  spyCloses: number[],
  tradingDaysToEarnings: number | undefined,
): INSResult {
  const closes    = ext.closes60d    ?? [];
  const volumes   = ext.volumes60d   ?? [];
  const surprises = ext.epsSurprises ?? [];

  const allCloses = appendLivePrice(closes, currentPrice);

  const momentum          = computeMomentum(allCloses, spyCloses);
  const deltaVqs          = computeDeltaVQS(ext);
  const volumeAccel       = computeVolumeAccel(allCloses, volumes);
  const epsSlope          = computeEPSSlopeScore(surprises);
  const earningsProximity = computeEarningsProximity(tradingDaysToEarnings);

  // ── INS Weight Table (revised — see history below) ──────────────────────────
  //   Momentum (consolidated accel + RS + streak):  30%
  //   Volume Acceleration:                          27%
  //   Earnings Proximity (forward-looking):         15%
  //   ΔVQS (fundamental re-rating):                 15%
  //   EPS Slope:                                    13%
  //                                                 ----
  //                                                 100%
  //
  // History: ΔGVS (25%) + Narrative Momentum (20%) were 45% combined and
  // mostly redundant (both just price momentum over overlapping windows) —
  // consolidated into Momentum above at 30%, freeing 15pts, with Earnings
  // Proximity added as a new forward-looking component.
  //
  // A first pass closed the remaining gap to 100% by scaling EPS Slope and
  // ΔVQS up proportionally from a draft 10%/15%. That was a mistake: it was
  // pure arithmetic convenience, not a decision about what INS should
  // measure, and it pushed ΔVQS — a fundamentals/re-rating signal — up to
  // 24%, nearly a quarter of a score that's supposed to answer "is momentum
  // inflecting right now," not "is this a good business" (VQS already
  // answers that). This revision instead closes the gap using the two
  // components that are genuinely forward/timing-oriented: Volume
  // Acceleration (20%→27% — a leading read on institutional positioning,
  // not a lagging one) and Earnings Proximity (10%→15% — the one explicitly
  // forward-looking catalyst in this score). ΔVQS returns to its original
  // 15% weight. EPS Slope — a lagging confirmation signal (past-quarter
  // beats) — takes a modest trim (16%→13%) rather than carrying a
  // disproportionate share of the fundamentals-adjacent weight on its own.
  const rawIns = clamp(
    0.30 * momentum +
    0.27 * volumeAccel +
    0.15 * earningsProximity +
    0.15 * deltaVqs +
    0.13 * epsSlope,
    0, 100,
  );

  // insLabel is a PURE magnitude label — no RSI/extension awareness. It used
  // to have its own independent RSI gate here (dampening ins itself and
  // swapping in an "EXTENDED"/"OVERSOLD REVERSAL" label), computed separately
  // from — and inconsistently with — the real signal-consistency check. That
  // was two independent RSI-gate implementations in the codebase at once.
  // insLabel isn't shown on any live page (grep confirms the only reader is
  // the retired/unrendered ScannerPage.tsx) — kept only for backward
  // compatibility and internal debugging, same as cos/csos/cpe/bps on
  // StockScore. Extension/chase-risk framing now lives in exactly one place:
  // signalLabel's computation in scores.ts, via signal-consistency.ts.
  const ins = Math.round(clamp(rawIns, 0, 100));
  const insLabel = getInsLabel(ins);

  return {
    ins,
    insLabel,
    divergenceTag: getDivergenceTag(ins, cos),
    insComponents: {
      momentum:          Math.round(momentum),
      deltaVqs:          Math.round(deltaVqs),
      volumeAccel:       Math.round(volumeAccel),
      epsSlope:          Math.round(epsSlope),
      earningsProximity: Math.round(earningsProximity),
    },
  };
}
