import type { ExtendedMetrics } from "./finnhub";

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface INSResult {
  ins: number;
  insLabel: string;
  divergenceTag: string;
  insComponents: {
    deltaGvs: number;
    deltaVqs: number;
    volumeAccel: number;
    epsSlope: number;
    narrativeMomentum: number;
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

// ── A. Delta GVS proxy: momentum acceleration (0-100) ─────────────────────────
// Compares 14-day return vs 30-day return. Positive = momentum accelerating.
function computeDeltaGVS(closes: number[]): number {
  if (closes.length < 31) return 50;
  const curr = closes[closes.length - 1]!;
  const c14  = closes[closes.length - 15]!;
  const c30  = closes[closes.length - 31]!;
  if (!c14 || !c30) return 50;
  const ret14 = (curr - c14) / c14 * 100;
  const ret30 = (curr - c30) / c30 * 100;
  return clamp(50 + (ret14 - ret30) * 2.5, 0, 100);
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

// ── E. Narrative Momentum Proxy (0-100) ──────────────────────────────────────
// 20D relative strength vs SPY + consecutive green day streak.
function computeNarrativeMomentum(closes: number[], spyCloses: number[]): number {
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

  const returnScore = clamp(50 + relStrength * 2, 0, 75);

  // Consecutive green closes (max 10 days)
  let streak = 0;
  for (let i = closes.length - 1; i > 0 && streak < 10; i--) {
    if ((closes[i] ?? 0) > (closes[i - 1] ?? 0)) streak++;
    else break;
  }
  const streakScore = clamp(streak * 3, 0, 25);

  return clamp(returnScore + streakScore, 0, 100);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeINS(
  ext: ExtendedMetrics,
  currentPrice: number,
  cos: number,
  spyCloses: number[]
): INSResult {
  const closes    = ext.closes60d    ?? [];
  const volumes   = ext.volumes60d   ?? [];
  const surprises = ext.epsSurprises ?? [];

  // Prepend stored closes with current live price for freshest calculation
  const allCloses = closes.length > 0 ? [...closes, currentPrice] : [currentPrice];

  const deltaGvs          = computeDeltaGVS(allCloses);
  const deltaVqs          = computeDeltaVQS(ext);
  const volumeAccel       = computeVolumeAccel(allCloses, volumes);
  const epsSlope          = computeEPSSlopeScore(surprises);
  const narrativeMomentum = computeNarrativeMomentum(allCloses, spyCloses);

  const ins = Math.round(clamp(
    0.25 * deltaGvs +
    0.20 * volumeAccel +
    0.20 * narrativeMomentum +
    0.20 * epsSlope +
    0.15 * deltaVqs
  ));

  return {
    ins,
    insLabel:      getInsLabel(ins),
    divergenceTag: getDivergenceTag(ins, cos),
    insComponents: {
      deltaGvs:          Math.round(deltaGvs),
      deltaVqs:          Math.round(deltaVqs),
      volumeAccel:       Math.round(volumeAccel),
      epsSlope:          Math.round(epsSlope),
      narrativeMomentum: Math.round(narrativeMomentum),
    },
  };
}
