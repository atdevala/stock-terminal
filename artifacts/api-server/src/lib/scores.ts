import type { ExtendedMetrics } from "./finnhub";
import { computeINS } from "./ins";
import { getSpyCloses60d } from "./finnhub";

// ── Math helpers ───────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

export function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function dailyRets(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const p = closes[i - 1]!;
    if (p !== 0) r.push((closes[i]! - p) / p * 100);
  }
  return r;
}

// ── Score label functions ──────────────────────────────────────────────────────

function vqsLabel(s: number): string {
  if (s >= 80) return "Undervalued / High Quality Growth";
  if (s >= 65) return "Fair Value / Strong Company";
  if (s >= 50) return "Neutral";
  if (s >= 35) return "Risky / Overvalued";
  return "Weak Fundamentals";
}

function gvsLabel(s: number): string {
  if (s >= 85) return "Breakout / Hyper-Growth Leader";
  if (s >= 70) return "Strong Uptrend Growth Stock";
  if (s >= 55) return "Early / Re-accelerating Growth";
  if (s >= 40) return "Stalled / High Risk";
  return "Broken Growth Story";
}

function cosLabel(s: number): string {
  if (s >= 80) return "Exceptional Opportunity";
  if (s >= 65) return "Strong Opportunity";
  if (s >= 50) return "Moderate Opportunity";
  if (s >= 35) return "Proceed with Caution";
  return "Avoid / High Risk";
}

// ── ACS: Accumulation Confidence Score ────────────────────────────────────────
// Detects quiet institutional accumulation before consensus forms.
// Formula: 0.30 UpVolumeStrength + 0.25 RelativeStrength + 0.20 PriceCompression
//        + 0.15 BreakoutVolume   + 0.10 ClosingStrength

function computeACS(ext: ExtendedMetrics, spyCloses: number[]): number {
  const closes  = ext.closes60d  ?? [];
  const volumes = ext.volumes60d ?? [];
  if (closes.length < 21 || volumes.length < 20) return 50;

  // 1. Up-Volume Strength (30%): % of total volume on up-days (last 20 days)
  let upVol = 0, totalVol = 0;
  const c21 = closes.slice(-21);
  const v20 = volumes.slice(-20);
  for (let i = 1; i < c21.length; i++) {
    const vol = v20[i - 1] ?? 0;
    totalVol += vol;
    if (c21[i]! > c21[i - 1]!) upVol += vol;
  }
  const upVolRatio   = totalVol > 0 ? upVol / totalVol : 0.5;
  const upVolStr     = clamp((upVolRatio - 0.35) / 0.35 * 100, 0, 100);

  // 2. Relative Strength vs SPY (25%): 20-day excess return
  const curr   = closes[closes.length - 1]!;
  const c20    = closes[closes.length - 21] ?? closes[0]!;
  const spyNow = spyCloses.length > 0  ? spyCloses[spyCloses.length - 1]!  : null;
  const spy20  = spyCloses.length >= 21 ? spyCloses[spyCloses.length - 21]! : null;
  let relStr = 50;
  if (spy20 && spyNow && c20) {
    const stkRet = (curr - c20) / c20 * 100;
    const spyRet = (spyNow - spy20) / spy20 * 100;
    relStr = clamp(50 + (stkRet - spyRet) * 2, 0, 100);
  }

  // 3. Price Compression (20%): recent vol < historical vol → coiling before breakout
  const rets20    = dailyRets(closes.slice(-21));
  const rets5     = rets20.slice(-5);
  const vol20d    = stddev(rets20);
  const vol5d     = stddev(rets5);
  const compression = vol20d > 0 ? clamp(100 - (vol5d / vol20d) * 100, 0, 100) : 50;

  // 4. Breakout Volume (15%): 5-day avg vol vs 20-day avg vol
  const avgV5   = mean(volumes.slice(-5));
  const avgV20  = mean(volumes.slice(-20));
  const brkVol  = avgV20 > 0 ? clamp((avgV5 / avgV20 - 0.8) / 1.2 * 100, 0, 100) : 50;

  // 5. Closing Strength (10%): price above 10-day SMA
  const sma10   = mean(closes.slice(-10));
  const closStr = sma10 > 0 ? clamp(50 + (curr - sma10) / sma10 * 1000, 0, 100) : 50;

  return Math.round(clamp(
    0.30 * upVolStr +
    0.25 * relStr   +
    0.20 * compression +
    0.15 * brkVol   +
    0.10 * closStr,
  ));
}

// ── FBRS: False Breakout Risk Score ──────────────────────────────────────────
// Detects hype-driven, unsustainable setups. High score = dangerous setup.
// Formula: 0.30 VolumeSpikeRisk + 0.25 PriceVolDivergence
//        + 0.25 RSWeakening     + 0.20 ExtremeVolatility

function computeFBRS(ext: ExtendedMetrics, spyCloses: number[]): number {
  const closes  = ext.closes60d  ?? [];
  const volumes = ext.volumes60d ?? [];
  if (closes.length < 11 || volumes.length < 10) return 50;

  // 1. Volume Spike Risk (30%): one-day spike then collapse
  const vols5     = volumes.slice(-5);
  const maxV5     = Math.max(...vols5);
  const avgV5     = mean(vols5);
  const spikeRisk = maxV5 > 0 ? clamp((1 - avgV5 / maxV5) * 150, 0, 100) : 0;

  // 2. Price–Volume Divergence (25%): price rising while volume weakens
  const priceRet5 = closes.length >= 6
    ? (closes[closes.length - 1]! - closes[closes.length - 6]!) / closes[closes.length - 6]! * 100
    : 0;
  const volFirst5 = mean(volumes.slice(-10, -5));
  const volLast5  = mean(volumes.slice(-5));
  const volDecl   = volFirst5 > 0 ? (volFirst5 - volLast5) / volFirst5 : 0;
  const pvDiv = priceRet5 > 0
    ? clamp(50 + volDecl * 200, 0, 100)
    : clamp(50 - volDecl * 100, 0, 100);

  // 3. Relative Strength Weakening (25%): RS declining short-term vs long-term
  let rsWeak = 50;
  if (spyCloses.length >= 21 && closes.length >= 21) {
    const stkR20 = (closes[closes.length - 1]! - closes[closes.length - 21]!) / closes[closes.length - 21]! * 100;
    const stkR5  = closes.length >= 6
      ? (closes[closes.length - 1]! - closes[closes.length - 6]!) / closes[closes.length - 6]! * 100
      : 0;
    const spyR20 = (spyCloses[spyCloses.length - 1]! - spyCloses[spyCloses.length - 21]!) / spyCloses[spyCloses.length - 21]! * 100;
    const spyR5  = spyCloses.length >= 6
      ? (spyCloses[spyCloses.length - 1]! - spyCloses[spyCloses.length - 6]!) / spyCloses[spyCloses.length - 6]! * 100
      : 0;
    const rs20 = stkR20 - spyR20;
    const rs5  = stkR5  - spyR5;
    rsWeak = clamp(50 + (rs20 - rs5) * 3, 0, 100);
  }

  // 4. Extreme Volatility (20%): high recent std dev without sustained direction
  const recRets = dailyRets(closes.slice(-6));
  const extVol  = clamp(stddev(recRets) * 15, 0, 100);

  return Math.round(clamp(
    0.30 * spikeRisk +
    0.25 * pvDiv     +
    0.25 * rsWeak    +
    0.20 * extVol,
  ));
}

// ── Multi-Timeframe Trend Classification ──────────────────────────────────────

function computeTrendLabel(closes: number[]): string {
  if (closes.length < 21) return "NEUTRAL";
  const curr  = closes[closes.length - 1]!;
  const c5    = closes.length >= 6  ? closes[closes.length - 6]!  : closes[0]!;
  const c20   = closes[closes.length - 21]!;
  const c60   = closes.length >= 61 ? closes[closes.length - 61]! : null;
  const r5    = c5  ? (curr - c5)  / c5  * 100 : 0;
  const r20   = c20 ? (curr - c20) / c20 * 100 : 0;
  const r60   = c60 ? (curr - c60) / c60 * 100 : null;
  if (r5 > 3 && r20 > 8 && r60 !== null && r60 > 20) return "LONG-TERM LEADER";
  if (r5 > 3 && r20 > 8) return "MID-TERM BREAKOUT";
  if (r5 > 3)            return "SHORT-TERM IGNITION";
  return "NEUTRAL";
}

// ── Conviction Tier Engine ────────────────────────────────────────────────────
// Tier 3 = High-Conviction / Tier 2 = Speculative / Tier 1 = Watchlist / 0 = No Signal

function computeConvictionTier(ins: number, cos: number, acs: number, fbrs: number): number {
  if (ins >= 70 && cos >= 50 && acs >= 65 && fbrs < 35) return 3;
  if (ins >= 60 && fbrs < 60)                           return 2;
  if (ins >= 45)                                         return 1;
  return 0;
}

// ── Superstock Candidate Detector ────────────────────────────────────────────
// Identifies early NVDA / CRDO / AVGO-type setups before consensus forms.

function computeSuperstock(ins: number, acs: number, fbrs: number): boolean {
  return ins >= 72 && acs >= 68 && fbrs < 28;
}

// ── StockScore interface ───────────────────────────────────────────────────────

export interface StockScore {
  ticker: string;
  vqs: number;
  gvs: number;
  cos: number;
  vqsLabel: string;
  gvsLabel: string;
  cosLabel: string;
  revenueGrowthYoy?: number;
  revenueGrowthQoQ?: number;
  grossMargin?: number;
  operatingMargin?: number;
  fcfMargin?: number;
  debtToEquity?: number;
  pe?: number;
  evSales?: number;
  priceAbove50MA?: boolean;
  priceAbove200MA?: boolean;
  earningsRevisionsUp?: boolean;
  ins?: number;
  insLabel?: string;
  divergenceTag?: string;
  insComponents?: {
    deltaGvs: number;
    deltaVqs: number;
    volumeAccel: number;
    epsSlope: number;
    narrativeMomentum: number;
  };
  // ── New signals ──────────────────────────────────────────────────────────
  acs: number;
  fbrs: number;
  trendLabel: string;
  convictionTier: number;
  isSuperstock: boolean;
}

// ── Master score computation ───────────────────────────────────────────────────

export function computeScore(ticker: string, ext: ExtendedMetrics, currentPrice: number, changePercent = 0): StockScore {
  const rg    = ext.revenueGrowthYoy ?? 0;
  const rgQ   = ext.revenueGrowthQoQ ?? 0;
  const gm    = ext.grossMargin      ?? 0;
  const opM   = ext.operatingMargin  ?? 0;
  const fcfM  = ext.fcfMargin        ?? 0;
  const de    = ext.debtToEquity     ?? 0;
  const pe    = ext.pe;
  const evS   = ext.evSales;
  const ma50  = ext.ma50;
  const ma200 = ext.ma200;
  const revisionsUp = ext.earningsRevisionsUp ?? false;

  const priceAbove50MA  = ma50  ? currentPrice > ma50  : false;
  const priceAbove200MA = ma200 ? currentPrice > ma200 : false;

  // ── VALUATION QUALITY SCORE ──────────────────────────────────────────────
  const growthScore = clamp(rg * 0.4, 0, 20);
  let valuationScore = 0;
  if (pe && pe > 0) {
    valuationScore = clamp(200 / pe, 0, 20);
  } else if (evS && evS > 0) {
    valuationScore = clamp(50 / evS, 0, 20);
  }
  const peg = (pe && pe > 0 && rg > 0) ? pe / Math.max(rg, 1) : 0;
  const pegScore    = peg > 0 ? clamp(20 / peg, 0, 20) : 0;
  const marginScore = clamp((gm * 0.1) + (opM * 0.2), 0, 20);
  let healthScore   = 20;
  if (fcfM < 0)  healthScore -= 5;
  if (rg < 0)    healthScore -= 5;
  if (de > 2)    healthScore -= 5;
  healthScore = clamp(healthScore, 0, 20);
  const vqs = Math.round(clamp(growthScore + valuationScore + pegScore + marginScore + healthScore));

  // ── GROWTH VOLATILITY SCORE ───────────────────────────────────────────────
  const growthAccelScore = clamp((rg * 0.3) + (rgQ * 0.5), 0, 25);
  const intradayPts = clamp(changePercent * 0.5, -5, 5);
  let momentumScore = 0;
  if (revisionsUp)      momentumScore += 15;
  if (priceAbove50MA)   momentumScore += 5;
  if (priceAbove200MA)  momentumScore += 5;
  momentumScore = clamp(momentumScore + intradayPts, 0, 25);
  let gvsValScore = 0;
  if (pe && pe > 0 && rg > 0) {
    const valAdj = pe / Math.max(rg, 1);
    gvsValScore = clamp(25 / Math.max(valAdj, 0.01), 0, 25);
  }
  const profScore = clamp((gm * 0.2) + (fcfM * 0.3), 0, 25);
  const gvs = Math.round(clamp(growthAccelScore + momentumScore + gvsValScore + profScore));

  // ── COMBINED OPPORTUNITY SCORE ────────────────────────────────────────────
  const cos = Math.round(clamp((0.5 * vqs) + (0.5 * gvs)));

  // ── INFLECTION SIGNAL SCORE ───────────────────────────────────────────────
  const spyCloses  = getSpyCloses60d();
  const insResult  = computeINS(ext, currentPrice, cos, spyCloses);
  const ins        = insResult.ins;

  // ── ACCUMULATION CONFIDENCE SCORE ─────────────────────────────────────────
  const acs = computeACS(ext, spyCloses);

  // ── FALSE BREAKOUT RISK SCORE ─────────────────────────────────────────────
  const fbrs = computeFBRS(ext, spyCloses);

  // ── MULTI-TIMEFRAME TREND ─────────────────────────────────────────────────
  const trendLabel = computeTrendLabel(ext.closes60d ?? []);

  // ── CONVICTION TIER + SUPERSTOCK ─────────────────────────────────────────
  const convictionTier = computeConvictionTier(ins, cos, acs, fbrs);
  const isSuperstock   = computeSuperstock(ins, acs, fbrs);

  return {
    ticker,
    vqs, gvs, cos,
    vqsLabel: vqsLabel(vqs),
    gvsLabel: gvsLabel(gvs),
    cosLabel: cosLabel(cos),
    revenueGrowthYoy:  ext.revenueGrowthYoy,
    revenueGrowthQoQ:  ext.revenueGrowthQoQ,
    grossMargin:       ext.grossMargin,
    operatingMargin:   ext.operatingMargin,
    fcfMargin:         ext.fcfMargin,
    debtToEquity:      ext.debtToEquity,
    pe:                ext.pe,
    evSales:           ext.evSales,
    priceAbove50MA,
    priceAbove200MA,
    earningsRevisionsUp: revisionsUp,
    ins:           insResult.ins,
    insLabel:      insResult.insLabel,
    divergenceTag: insResult.divergenceTag,
    insComponents: insResult.insComponents,
    acs,
    fbrs,
    trendLabel,
    convictionTier,
    isSuperstock,
  };
}
