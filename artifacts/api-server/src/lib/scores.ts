import type { ExtendedMetrics, QuoteData } from "./finnhub";
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
// Uses: 52W range position, EPS surprise momentum, revenue acceleration,
//       margin quality, analyst consensus — all from REST endpoints.
//
// Formula: 0.30 RangePosition + 0.25 EPSSurpriseMomentum
//        + 0.20 RevenueAcceleration + 0.15 MarginQuality + 0.10 AnalystConsensus

function computeACS(ext: ExtendedMetrics, quote: QuoteData | undefined): number {
  const price  = quote?.price   ?? 0;
  const high52 = quote?.high52  ?? 0;
  const low52  = quote?.low52   ?? 0;

  // 1. 52W Range Position (30%)
  // Sweet spot: 50–85% of 52W range signals sustained accumulation.
  // Bottom half = weak / distribution; very top = overextended.
  let rangeSig = 50;
  if (high52 > low52 && price > 0) {
    const pos = (price - low52) / (high52 - low52); // 0–1
    if (pos <= 0.35) {
      rangeSig = clamp(pos / 0.35 * 45, 0, 45);           // 0–45 — weak range
    } else if (pos <= 0.85) {
      rangeSig = clamp(45 + (pos - 0.35) / 0.50 * 55, 45, 100); // 45–100 — sweet spot
    } else {
      rangeSig = clamp(100 - (pos - 0.85) / 0.15 * 20, 80, 100); // 80–100 — slightly penalised at top
    }
  }

  // 2. EPS Surprise Momentum (25%)
  // Consecutive beats = smart money positioned ahead of public.
  const eps = ext.epsSurprises ?? [];
  let epsSig = 50;
  if (eps.length > 0) {
    const avg = eps.reduce((a, b) => a + b, 0) / eps.length;
    // avg beat of +10% → ~58; +50% → ~90; miss of -20% → ~34
    epsSig = clamp(50 + avg * 0.8, 0, 100);
  }

  // 3. Revenue Acceleration (20%)
  // QoQ growth > YoY = accelerating — institutions detect this early.
  const yoy = ext.revenueGrowthYoy ?? 0;
  const qoq = ext.revenueGrowthQoQ ?? 0;
  // If both are positive and QoQ > YoY the score rises above 50.
  // Also lift for strongly positive YoY even without QoQ signal.
  const baseMomentum = clamp(50 + yoy * 0.5, 0, 100);
  const accelBonus   = clamp((qoq - yoy) * 1.5, -30, 30);
  const revAccel     = clamp(baseMomentum + accelBonus, 0, 100);

  // 4. Margin Quality (15%)
  // High gross + positive operating margins = institutional-grade business.
  const gm  = ext.grossMargin     ?? 0;
  const opM = ext.operatingMargin ?? 0;
  // Gross margin 60% → ~24; operating margin 20% → ~20; combined ~44 + base 30 ≈ 74
  const marginSig = clamp(30 + gm * 0.4 + Math.max(opM, 0) * 0.6, 0, 100);

  // 5. Analyst Consensus Upgrade (10%)
  const consensusSig = ext.earningsRevisionsUp ? 75 : 35;

  return Math.round(clamp(
    0.30 * rangeSig    +
    0.25 * epsSig      +
    0.20 * revAccel    +
    0.15 * marginSig   +
    0.10 * consensusSig,
  ));
}

// ── FBRS: False Breakout Risk Score ──────────────────────────────────────────
// Detects hype-driven, unsustainable setups. High score = dangerous setup.
// Uses: valuation overextension, 52W overextension, EPS miss history,
//       revenue deceleration — all from REST endpoints.
//
// Formula: 0.30 ValuationRisk + 0.25 52WOverextension
//        + 0.25 EPSMissRisk   + 0.20 RevenueDeceleration

function computeFBRS(ext: ExtendedMetrics, quote: QuoteData | undefined): number {
  const price  = quote?.price   ?? 0;
  const high52 = quote?.high52  ?? 0;
  const low52  = quote?.low52   ?? 0;

  // 1. Valuation Risk (30%)
  // Very high PE = more vulnerable to correction when sentiment shifts.
  const pe = ext.pe ?? quote?.pe ?? 0;
  let peSig = 40; // neutral default
  if (pe > 0) {
    // PE 20 → 10, PE 50 → 33, PE 100 → 67, PE 200+ → 100
    peSig = clamp((pe - 10) / 190 * 100, 0, 100);
  }

  // 2. 52W Overextension (25%)
  // Price very near 52W high after a large run-up = false breakout risk.
  let extRisk = 40;
  if (high52 > low52 && price > 0) {
    const pos   = (price - low52) / (high52 - low52);
    const runUp = (high52 - low52) / Math.max(low52, 1) * 100;
    // Only penalise when there was a meaningful run (>40%) AND price is extended
    if (runUp > 40) {
      extRisk = clamp(pos * 100, 0, 100);
    } else {
      extRisk = clamp(pos * 60, 0, 60); // smaller run-up = lower risk at same position
    }
  }

  // 3. EPS Miss Risk (25%)
  // Recent misses = fundamentals weakening, false breakout risk rises.
  const eps = ext.epsSurprises ?? [];
  let missSig = 50;
  if (eps.length > 0) {
    const avg = eps.reduce((a, b) => a + b, 0) / eps.length;
    missSig = clamp(50 - avg * 0.8, 0, 100); // inverse of ACS eps signal
  }

  // 4. Revenue Deceleration (20%)
  // YoY declining or QoQ well below YoY = momentum fading.
  const yoy = ext.revenueGrowthYoy ?? 0;
  const qoq = ext.revenueGrowthQoQ ?? 0;
  const decel = clamp(50 + (yoy - qoq) * 1.5, 0, 100); // inverse of ACS rev signal

  return Math.round(clamp(
    0.30 * peSig   +
    0.25 * extRisk +
    0.25 * missSig +
    0.20 * decel,
  ));
}

// ── Multi-Timeframe Trend Classification ──────────────────────────────────────
// Uses 52W range position + revenue growth + intraday change.
// Falls back to candle-based logic when closes are available.

function computeTrendLabel(ext: ExtendedMetrics, quote: QuoteData | undefined): string {
  const closes = ext.closes60d ?? [];

  // Preferred: candle-based (when available)
  if (closes.length >= 21) {
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

  // Fallback: fundamentals + quote signals
  const price    = quote?.price         ?? 0;
  const high52   = quote?.high52        ?? 0;
  const low52    = quote?.low52         ?? 0;
  const changePct = quote?.changePercent ?? 0;
  const yoy      = ext.revenueGrowthYoy ?? 0;

  if (high52 <= low52 || price <= 0) return "NEUTRAL";

  const rangePos = (price - low52) / (high52 - low52); // 0–1

  // Strong range position + meaningful revenue growth + not in freefall
  if (rangePos >= 0.75 && yoy > 15 && changePct > -3) return "LONG-TERM LEADER";
  // Good range position + any positive growth
  if (rangePos >= 0.55 && yoy > 5)                     return "MID-TERM BREAKOUT";
  // Recent strong intraday momentum regardless of range
  if (changePct > 5)                                    return "SHORT-TERM IGNITION";
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

export function computeScore(
  ticker: string,
  ext: ExtendedMetrics,
  currentPrice: number,
  changePercent = 0,
  quote?: QuoteData,
): StockScore {
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
  const acs = computeACS(ext, quote);

  // ── FALSE BREAKOUT RISK SCORE ─────────────────────────────────────────────
  const fbrs = computeFBRS(ext, quote);

  // ── MULTI-TIMEFRAME TREND ─────────────────────────────────────────────────
  const trendLabel = computeTrendLabel(ext, quote);

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
