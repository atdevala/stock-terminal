import type { ExtendedMetrics, QuoteData } from "./finnhub";
import { computeINS } from "./ins";
import { getSpyCloses60d, getMarketRegime } from "./finnhub";
import { logger } from "./logger";

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

// ── ACSv2: Institutional-Grade Accumulation Confidence Score ─────────────────
//
// A significantly improved model replacing ACSv1. Detects TRUE institutional
// accumulation using candle-based volume, relative strength persistence,
// closing strength, volatility compression, and liquidity quality.
//
// Five components × weights:
//   35% — Volume Structure    (OBV trend, relative vol, up-vol dominance)
//   25% — RS Persistence      (excess return vs SPY over 1D / 5D / 20D)
//   15% — Closing Strength    (CLV, up-close %, MA support)
//   15% — Volatility Compress (realized vol contraction, Bollinger squeeze)
//   10% — Liquidity Quality   (dollar volume level & stability)
//
// × Institutional Quality Multiplier [0.65–1.15]
//   Penalizes parabolic blowoffs, high intraday dispersion, erratic action.
//   Rewards steady multi-session accumulation with low-volatility structure.

function computeACS_v2(
  ext:       ExtendedMetrics,
  quote:     QuoteData | undefined,
  spyCloses: number[],
): number {
  const closes  = ext.closes60d  ?? [];
  const volumes = ext.volumes60d ?? [];
  const price    = quote?.price      ?? 0;
  const high52   = quote?.high52     ?? 0;
  const low52    = quote?.low52      ?? 0;
  const qHigh    = quote?.high       ?? 0;
  const qLow     = quote?.low        ?? 0;
  const qOpen    = quote?.open       ?? 0;
  const qPrev    = quote?.prevClose  ?? 0;
  const changePct = quote?.changePercent ?? 0;
  const candleMode = closes.length >= 20 && volumes.length >= 20;

  // ── 1. VOLUME STRUCTURE (35%) ──────────────────────────────────────────────
  // Candle mode:  OBV slope + relative volume + up-day volume dominance.
  // Fundamental fallback: EPS beat consistency + revenue acceleration +
  //   today's intraday buying pressure (close vs open as proxy).

  let volumeScore: number;

  if (candleMode) {
    const n = Math.min(closes.length, volumes.length);

    // 1a. On-Balance Volume — net buying pressure over 20 days
    let obv = 0;
    const obvSeries: number[] = [0];
    for (let i = 1; i < n; i++) {
      const delta = closes[i]! - closes[i - 1]!;
      obv += delta > 0 ? volumes[i]! : delta < 0 ? -volumes[i]! : 0;
      obvSeries.push(obv);
    }
    const avgVol30 = volumes.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, volumes.length);
    const obv20Ago = obvSeries[Math.max(0, obvSeries.length - 21)] ?? obvSeries[0]!;
    const obvSlope = avgVol30 > 0 ? (obv - obv20Ago) / (avgVol30 * 20) : 0;
    const obvScore = clamp(50 + obvSlope * 100, 0, 100);

    // 1b. Sustained relative volume (10D avg vs 30D avg)
    const vol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const vol30 = volumes.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, volumes.length);
    const relVolScore = clamp(50 + (vol30 > 0 ? (vol10 / vol30) - 1 : 0) * 100, 0, 100);

    // 1c. Up-day volume dominance over last 20 days
    let upVol = 0, downVol = 0;
    for (let i = Math.max(1, n - 20); i < n; i++) {
      const d = closes[i]! - closes[i - 1]!;
      if (d > 0) upVol += volumes[i]!; else if (d < 0) downVol += volumes[i]!;
    }
    const total = upVol + downVol;
    const upVolScore = clamp((total > 0 ? upVol / total : 0.5) * 140 - 20, 0, 100);

    volumeScore = clamp(0.50 * obvScore + 0.25 * relVolScore + 0.25 * upVolScore, 0, 100);

  } else {
    // Fundamental fallback — proxy for volume-driven accumulation:

    // a. EPS beat momentum: institutions position before public knows (40%)
    // Consistent beats = smart money already accumulating.
    const eps = ext.epsSurprises ?? [];
    let epsSig = 50;
    if (eps.length > 0) {
      const avg = eps.reduce((a, b) => a + b, 0) / eps.length;
      // avg beat +10% → ~58; +40% → ~82; miss -20% → ~34
      epsSig = clamp(50 + avg * 0.8, 0, 100);
      // Boost for consistent beats (all quarters positive)
      if (eps.length >= 3 && eps.every(e => e > 0)) epsSig = clamp(epsSig + 10, 0, 100);
    }

    // b. Revenue acceleration: QoQ > YoY = growth inflecting (30%)
    const yoy = ext.revenueGrowthYoy ?? 0;
    const qoq = ext.revenueGrowthQoQ ?? 0;
    const revBase  = clamp(50 + yoy * 0.5, 0, 100);
    const revAccel = clamp(revBase + (qoq - yoy) * 1.5, 0, 100);

    // c. Intraday close vs open: buying pressure proxy (30%)
    // If price closed well above its open, buyers stepped in.
    let intradayBuyScore = 50;
    if (qHigh > qLow && qOpen > 0 && price > 0) {
      const clv = (price - qLow) / (qHigh - qLow); // 0=bottom, 1=top of day's range
      intradayBuyScore = clamp(clv * 100, 0, 100);
    } else if (qPrev > 0) {
      // Fallback: day gain is a weak proxy
      intradayBuyScore = clamp(50 + changePct * 3, 0, 100);
    }

    volumeScore = clamp(0.40 * epsSig + 0.30 * revAccel + 0.30 * intradayBuyScore, 0, 100);
  }

  // ── 2. RELATIVE STRENGTH PERSISTENCE (25%) ────────────────────────────────
  // Candle mode:  daily excess return vs SPY over 1D / 5D / 20D + persistence ratio.
  // Fundamental fallback: 52W range sweet-spot + revenue growth outperformance.

  let rsScore: number;

  if (closes.length >= 10 && spyCloses.length >= 10) {
    const n = Math.min(closes.length, spyCloses.length, 20);
    const stockSlice = closes.slice(-n);
    const spySlice   = spyCloses.slice(-n);

    const excessRets: number[] = [];
    for (let i = 1; i < n; i++) {
      const sRet   = stockSlice[i - 1]! > 0 ? (stockSlice[i]!   - stockSlice[i - 1]!)   / stockSlice[i - 1]!   * 100 : 0;
      const spyRet = spySlice[i - 1]!   > 0 ? (spySlice[i]!     - spySlice[i - 1]!)     / spySlice[i - 1]!     * 100 : 0;
      excessRets.push(sRet - spyRet);
    }

    if (excessRets.length > 0) {
      const rs20D = excessRets.reduce((a, b) => a + b, 0);
      const rs5D  = excessRets.slice(-5).reduce((a, b) => a + b, 0);
      const rs1D  = excessRets[excessRets.length - 1] ?? 0;
      const posCount = excessRets.filter(r => r > 0).length;
      const persistScore = clamp(posCount / excessRets.length * 120 - 10, 0, 100);
      rsScore = clamp(
        0.40 * clamp(50 + rs20D * 2, 0, 100) +
        0.30 * persistScore +
        0.20 * clamp(50 + rs5D  * 5, 0, 100) +
        0.10 * clamp(50 + rs1D  * 8, 0, 100),
        0, 100,
      );
    } else {
      rsScore = 50;
    }

  } else {
    // Fundamental fallback — proxy for RS persistence:

    // a. 52W range position sweet spot (50–85% = sustained RS, not yet exhausted)
    let rangeSig = 50;
    if (high52 > low52 && price > 0) {
      const pos = (price - low52) / (high52 - low52);
      if (pos <= 0.35)       rangeSig = clamp(pos / 0.35 * 40, 0, 40);
      else if (pos <= 0.85)  rangeSig = clamp(40 + (pos - 0.35) / 0.50 * 60, 40, 100);
      else                   rangeSig = clamp(100 - (pos - 0.85) / 0.15 * 25, 75, 100);
    }

    // b. Revenue growth vs 15% benchmark (persistent outperformance)
    const yoy = ext.revenueGrowthYoy ?? 0;
    const revRsSig = clamp(50 + (yoy - 15) * 1.2, 0, 100);

    // c. Analyst revisions as RS confirmation
    const revisionSig = ext.earningsRevisionsUp ? 72 : 35;

    rsScore = clamp(0.55 * rangeSig + 0.30 * revRsSig + 0.15 * revisionSig, 0, 100);
  }

  // ── 3. CLOSING STRENGTH (15%) ─────────────────────────────────────────────
  // Candle mode:  CLV within rolling 20D range + up-close % + MA support.
  // Fundamental fallback: today's intraday CLV + 52W range context + MA.

  let closeStrScore: number;

  if (closes.length >= 10) {
    const recent = closes.slice(-20);
    const rHigh  = Math.max(...recent);
    const rLow   = Math.min(...recent);
    const lastClose = closes[closes.length - 1]!;
    const clv = rHigh > rLow ? (lastClose - rLow) / (rHigh - rLow) : 0.5;
    const clvScore = clamp(clv * 100, 0, 100);

    let upCloseCount = 0;
    for (let i = 1; i <= Math.min(10, closes.length - 1); i++) {
      if (closes[closes.length - i]! > closes[closes.length - i - 1]!) upCloseCount++;
    }
    const upCloseScore = clamp((upCloseCount / 10) * 130 - 15, 0, 100);

    let maSupportScore = 50;
    if (ext.ma50 && ext.ma200 && price > 0) {
      maSupportScore = price > ext.ma50 && price > ext.ma200 ? 85
        : price > ext.ma50  ? 65
        : price > ext.ma200 ? 55 : 25;
    } else if (ext.ma50 && price > 0) {
      maSupportScore = price > ext.ma50 ? 65 : 35;
    }

    closeStrScore = clamp(0.40 * clvScore + 0.35 * upCloseScore + 0.25 * maSupportScore, 0, 100);

  } else {
    // Fundamental fallback:

    // a. Today's intraday CLV: (close - low) / (high - low)
    let intradayClv = 50;
    if (qHigh > qLow && price > 0) {
      intradayClv = clamp(((price - qLow) / (qHigh - qLow)) * 100, 0, 100);
    }

    // b. 52W position: upper half = stock holding strength structurally
    let rangeClv = 50;
    if (high52 > low52 && price > 0) {
      rangeClv = clamp(((price - low52) / (high52 - low52)) * 100, 0, 100);
    }

    // c. MA support (unchanged — computed from candles regardless)
    let maSupportScore = 50;
    if (ext.ma50 && ext.ma200 && price > 0) {
      maSupportScore = price > ext.ma50 && price > ext.ma200 ? 85
        : price > ext.ma50  ? 65
        : price > ext.ma200 ? 55 : 25;
    } else if (ext.ma50 && price > 0) {
      maSupportScore = price > ext.ma50 ? 65 : 35;
    }

    closeStrScore = clamp(0.35 * intradayClv + 0.35 * rangeClv + 0.30 * maSupportScore, 0, 100);
  }

  // ── 4. VOLATILITY COMPRESSION / COILING (15%) ─────────────────────────────
  // Candle mode:  10D vs 30D realized vol ratio + Bollinger Band width.
  // Fundamental fallback: 52W range width + margin quality as stability proxy.

  let compressionScore: number;

  if (closes.length >= 20) {
    const dailyRets10 = dailyRets(closes.slice(-11));
    const dailyRets30 = dailyRets(closes.slice(-31));
    const vol10D = stddev(dailyRets10);
    const vol30D = stddev(dailyRets30.length >= 2 ? dailyRets30 : dailyRets10);
    const volRatio = vol30D > 0 ? vol10D / vol30D : 1;
    const volCompScore = clamp(50 + (1 - volRatio) * 70, 0, 100);

    const closes20 = closes.slice(-20);
    const ma20     = closes20.reduce((a, b) => a + b, 0) / 20;
    const bb20std  = stddev(closes20);
    const bbWidth  = ma20 > 0 ? (4 * bb20std) / ma20 * 100 : 10;
    const bbScore  = clamp(100 - (bbWidth - 4) * 4, 0, 100);

    compressionScore = clamp(0.60 * volCompScore + 0.40 * bbScore, 0, 100);

  } else {
    // Fundamental fallback:

    // a. 52W range width: narrow range = price is coiling (compression proxy)
    // A stock that has been consolidating stays within a tight 52W band.
    let rangeWidthScore = 50;
    if (high52 > low52 && low52 > 0) {
      const rangeWidth = (high52 - low52) / low52 * 100; // as % of low
      // <30% wide → high score (tight base); >150% wide → low score (volatile)
      rangeWidthScore = clamp(100 - (rangeWidth - 20) * 0.6, 0, 100);
    }

    // b. Margin quality: high-margin businesses have lower structural volatility
    const gm  = ext.grossMargin     ?? 0;
    const opM = ext.operatingMargin ?? 0;
    const marginStabilityScore = clamp(30 + gm * 0.3 + Math.max(opM, 0) * 0.5, 0, 100);

    compressionScore = clamp(0.55 * rangeWidthScore + 0.45 * marginStabilityScore, 0, 100);
  }

  // ── 5. LIQUIDITY QUALITY (10%) ────────────────────────────────────────────
  // Candle mode:  rolling dollar-volume stability (CV) + absolute size.
  // Fundamental fallback: margin quality as business-quality / tradability proxy.

  let liquidityScore: number;

  if (closes.length >= 10 && volumes.length >= 10) {
    const n = Math.min(closes.length, volumes.length, 20);
    const dolVols = Array.from({ length: n }, (_, i) =>
      (closes[closes.length - n + i]! * (volumes[volumes.length - n + i]!))
    );
    const avgDolVol = dolVols.reduce((a, b) => a + b, 0) / n;
    const stdDolVol = stddev(dolVols);
    const cv = avgDolVol > 0 ? stdDolVol / avgDolVol : 1;
    const stabilityScore = clamp(100 - cv * 80, 0, 100);
    const dolVolLevel    = avgDolVol > 0
      ? clamp(20 + Math.log10(Math.max(avgDolVol / 1e6, 0.001)) * 20, 0, 100)
      : 50;
    liquidityScore = clamp(0.50 * stabilityScore + 0.50 * dolVolLevel, 0, 100);

  } else {
    // Fundamental fallback: gross + operating margins as institutional quality proxy.
    // High-margin businesses attract institutional money; low-margin repels it.
    const gm  = ext.grossMargin     ?? 0;
    const opM = ext.operatingMargin ?? 0;
    liquidityScore = clamp(30 + gm * 0.4 + Math.max(opM, 0) * 0.5, 0, 100);
  }

  // ── INSTITUTIONAL QUALITY MULTIPLIER [0.65 – 1.15] ───────────────────────
  // Candle mode:  detects parabolic moves, high dispersion, and steady climbs.
  // Fundamental fallback: uses 52W overextension + EPS consistency + FCF quality.

  let multiplier = 1.0;

  if (closes.length >= 10) {
    const last5Ret = closes.length >= 6
      ? (closes[closes.length - 1]! - closes[closes.length - 6]!) / closes[closes.length - 6]! * 100
      : 0;
    const prior15Avg = closes.length >= 21
      ? (closes[closes.length - 6]! - closes[closes.length - 21]!) / closes[closes.length - 21]! * 100 / 3
      : last5Ret;

    if (last5Ret > 15 && last5Ret > prior15Avg * 3)      multiplier -= 0.18;
    else if (last5Ret > 10 && last5Ret > prior15Avg * 2) multiplier -= 0.08;

    const ret20D = closes.length >= 21
      ? (closes[closes.length - 1]! - closes[closes.length - 21]!) / closes[closes.length - 21]! * 100
      : 0;
    if (ret20D > 8 && ret20D < 35)      multiplier += 0.10;
    else if (ret20D > 3 && ret20D < 15) multiplier += 0.05;

    const ret10 = dailyRets(closes.slice(-11));
    const vol10 = stddev(ret10);
    if (vol10 > 5)        multiplier -= 0.15;
    else if (vol10 > 3.5) multiplier -= 0.07;
    else if (vol10 < 1.5) multiplier += 0.08;

    if (high52 > low52 && price > 0) {
      if ((price - low52) / (high52 - low52) > 0.93) multiplier -= 0.05;
    }

  } else {
    // Fundamental multiplier fallback:

    // Penalize: 52W overextension (price at very top of 52W range = potential exhaustion)
    if (high52 > low52 && price > 0) {
      const pos = (price - low52) / (high52 - low52);
      if (pos > 0.92) multiplier -= 0.10;
      else if (pos > 0.80) multiplier -= 0.04;
    }

    // Penalize: erratic EPS (misses after beats = unstable business)
    const eps = ext.epsSurprises ?? [];
    if (eps.length >= 2) {
      const hasRecentMiss = eps[0]! < -5;  // most recent quarter a big miss
      if (hasRecentMiss) multiplier -= 0.10;
    }

    // Reward: FCF positive + no excess debt = institutional quality
    const fcfM = ext.fcfMargin    ?? 0;
    const de   = ext.debtToEquity ?? 0;
    if (fcfM > 5 && de < 1.5)  multiplier += 0.10;
    else if (fcfM > 0)          multiplier += 0.04;
    else if (fcfM < -10)        multiplier -= 0.08;

    // Reward: analyst upgrades = forward confirmation of accumulation thesis
    if (ext.earningsRevisionsUp) multiplier += 0.05;
  }

  multiplier = clamp(multiplier, 0.65, 1.15);

  // ── COMPOSITE ACSv2 SCORE ─────────────────────────────────────────────────
  const raw =
    0.35 * volumeScore      +
    0.25 * rsScore          +
    0.15 * closeStrScore    +
    0.15 * compressionScore +
    0.10 * liquidityScore;

  return Math.round(clamp(raw * multiplier, 0, 100));
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

// ── CPE: Catalyst Probability Engine ─────────────────────────────────────────
// Estimates probability that the market is underpricing a future major catalyst.
// Watchlist tab ONLY. Uses existing computed signals as proxies — no extra API
// calls needed. Proxy components:
//   25% — Narrative Asymmetry     (quality gap vs public consensus)
//   25% — Quiet Accumulation      (ACS elevated without COS breakout)
//   20% — Low Attention / Quality (strong VQS unrecognized by COS/INS)
//   20% — False Hype Filter       (inverse FBRS — clean institutional setup)
//   10% — Strategic Positioning   (INS + ACS leading without COS confirmation)

export function calculateCPE(
  vqs: number,
  gvs: number,
  ins: number,
  acs: number,
  cos: number,
  fbrs: number,
): number {
  const v = isFinite(vqs) ? vqs : 50;
  const g = isFinite(gvs) ? gvs : 50;
  const i = isFinite(ins) ? ins : 50;
  const a = isFinite(acs) ? acs : 50;
  const c = isFinite(cos) ? cos : 50;
  const f = isFinite(fbrs) ? fbrs : 50;

  // ── 1. NARRATIVE ASYMMETRY (25%) ─────────────────────────────────────────
  // Blended quality (VQS + GVS) is strong but COS hasn't priced it in yet
  // = market underpricing an improving story. The wider the gap, the higher
  // the probability that a rerating catalyst is approaching.
  const qualitySignal = v * 0.60 + g * 0.40;
  const narrativeGap  = qualitySignal - c;
  let narrativeScore: number;
  if (narrativeGap > 25 && v >= 50) {
    narrativeScore = clamp(55 + narrativeGap * 0.9, 0, 100);
  } else if (narrativeGap > 10 && v >= 40) {
    narrativeScore = clamp(45 + narrativeGap * 0.65, 0, 100);
  } else if (narrativeGap < -10) {
    // Story already fully recognized — lower forward catalyst probability
    narrativeScore = clamp(50 + narrativeGap * 0.4, 0, 100);
  } else {
    narrativeScore = 45;
  }

  // ── 2. QUIET ACCUMULATION (25%) ──────────────────────────────────────────
  // ACS elevated + COS still low + FBRS clean = institutions positioning before
  // the public breakout. Highest CPE signal when accumulation is genuinely quiet.
  let accumScore: number;
  if (a >= 65 && c < 60 && f < 40) {
    // Prime stealth accumulation window: high ACS, pre-breakout, low noise
    accumScore = clamp(60 + (a - 65) * 0.9 + (60 - c) * 0.35, 0, 100);
  } else if (a >= 55 && c < 65) {
    // Moderate accumulation: building but not yet confirmed
    accumScore = clamp(45 + (a - 55) * 0.65, 0, 100);
  } else if (a < 40) {
    // No meaningful accumulation = low catalyst probability
    accumScore = clamp(a * 0.6, 0, 100);
  } else {
    accumScore = 40;
  }

  // ── 3. LOW ATTENTION / HIGH QUALITY (20%) ────────────────────────────────
  // Strong business quality (VQS) not yet reflected in momentum signals
  // = market hasn't noticed yet, potential for surprise discovery.
  let attentionScore: number;
  if (v >= 62 && c < 55 && i < 58) {
    attentionScore = clamp(60 + (v - 62) * 0.85 + (55 - c) * 0.30, 0, 100);
  } else if (v >= 50 && c < 62) {
    attentionScore = clamp(42 + (v - 50) * 0.55, 0, 100);
  } else {
    attentionScore = 35;
  }

  // ── 4. FALSE HYPE FILTER (20%) ────────────────────────────────────────────
  // High FBRS = speculative noise-driven setup, not a real catalyst opportunity.
  // Clean, institutional-quality setups (low FBRS) have the highest CPE.
  const hypeFilterScore = clamp(100 - f, 0, 100);

  // ── 5. STRATEGIC POSITIONING SIGNAL (10%) ────────────────────────────────
  // INS leading + ACS confirming + COS still lagging = smart money moving into
  // position before the catalyst becomes broadly known. Pre-catalyst window.
  let strategicScore: number;
  if (i >= 62 && a >= 58 && c < 58) {
    strategicScore = clamp(55 + (i - 62) * 0.85 + (a - 58) * 0.40, 0, 100);
  } else if (i >= 55 && a >= 50) {
    strategicScore = clamp(45 + (i - 55) * 0.55, 0, 100);
  } else {
    strategicScore = 35;
  }

  // ── COMPOSITE CPE ────────────────────────────────────────────────────────
  const raw =
    0.25 * narrativeScore   +
    0.25 * accumScore       +
    0.20 * attentionScore   +
    0.20 * hypeFilterScore  +
    0.10 * strategicScore;

  return Math.round(clamp(raw, 1, 100));
}

// ── CSOS: Composite Stock Opportunity Score ───────────────────────────────────
// A multi-layer institutional decision model for the watchlist tab ONLY.
//
// Base weights:  VQS 40% | GVS 25% | INS 15% | ACS 12% | COS 8%
//
// Intelligence layers applied on top of the weighted base:
//   1. Early Breakout Edge    — INS leading COS bonus
//   2. Late Stage Warning     — COS extended / INS fading penalty
//   3. Fundamental Floor      — VQS < 40 risk override
//   4. Accumulation Boost     — INS + ACS co-elevated multiplier
//   5. Signal Divergence      — conflicting signals penalty
//   6. Signal Agreement       — all signals aligned bonus
//   7. Regime Awareness       — SPY trend / volatility multiplier
//   8. Catalyst Bonus         — CPE-driven small upside contribution
//
// Isolated to watchlist pipeline. Does NOT affect Scanner, Signal Tracker,
// or any other module. Safely handles null/missing values via defaults.

// Context-aware label — pattern of signals matters more than raw score level.
// Priority order ensures the label reflects WHY the score is high/low, not
// just THAT it is high/low. Checked in decreasing priority order.
function csosLabelText(
  s: number, v: number, i: number, a: number, c: number, cpe = 50,
): string {
  // 1. Fundamental weakness overrides all positive signals
  if (v < 40) return "LOW QUALITY / AVOID";
  // 2. Move extended, leading signal fading — forward edge is poor
  if (c > 80 && i < 50) return "LATE STAGE MOVE";
  // 3. INS leading COS — specific early-stage institutional pattern
  if (i > 75 && c < 60) return "EARLY BREAKOUT SETUP";
  // 4. All major signals aligned — rare full-conviction setup
  if (i > 70 && a > 70 && c > 70 && v > 60) return "PRIME OPPORTUNITY";
  // 5. Quiet institutional building — high ACS, high CPE, no breakout yet
  if (a >= 65 && c < 55 && cpe >= 60) return "STEALTH ACCUMULATION";
  // 6. High catalyst probability unrecognized by momentum signals
  if (cpe >= 70 && c < 55) return "HIDDEN CATALYST POTENTIAL";
  // 7. Fundamentals-driven score — established quality leader
  if (v >= 65 && s >= 52) return "QUALITY COMPOUNDER";
  // 8. Momentum confirmed with institutional backing
  if (c >= 60 && i >= 50 && s >= 48) return "CONFIRMED TREND";
  // 9. Signals building but no clear dominant pattern yet
  if (s >= 35) return "DEVELOPING SETUP";
  return "LOW QUALITY / AVOID";
}

export function calculateCSOS(
  vqs: number,
  gvs: number,
  ins: number,
  acs: number,
  cos: number,
  regime: string,
  cpe = 50,
): { csos: number; csosLabel: string } {
  // Guard against NaN inputs
  const v = isFinite(vqs) ? vqs : 50;
  const g = isFinite(gvs) ? gvs : 50;
  const i = isFinite(ins) ? ins : 50;
  const a = isFinite(acs) ? acs : 50;
  const c = isFinite(cos) ? cos : 50;

  // ── 1. BASE WEIGHTED SCORE ────────────────────────────────────────────────
  let score = v * 0.40 + g * 0.25 + i * 0.15 + a * 0.12 + c * 0.08;

  // ── 2. EARLY BREAKOUT EDGE ────────────────────────────────────────────────
  // INS leads COS by 2–6 weeks. High INS + low COS = pre-breakout positioning.
  if (i > 75 && c < 60) {
    const bonus = i > 85 ? 10 : i > 80 ? 8 : 5;
    score += bonus;
  }

  // ── 3. LATE STAGE WARNING ─────────────────────────────────────────────────
  // COS very high but INS fading = move already extended, weak forward edge.
  if (c > 80 && i < 50) {
    const penalty = i < 40 ? 10 : 6;
    score -= penalty;
  }

  // ── 4. FUNDAMENTAL FLOOR (RISK OVERRIDE) ──────────────────────────────────
  // VQS below 40 = structurally weak company; override other bullish signals.
  if (v < 40) {
    const penalty = v < 25 ? 18 : v < 30 ? 14 : 10;
    score -= penalty;
  }

  // ── 5. ACCUMULATION CONFIRMATION BOOST ───────────────────────────────────
  // Both INS and ACS elevated = early momentum + institutional alignment.
  // High absolute levels on both strongly imply co-trending upward.
  if (i >= 65 && a >= 65) {
    const multiplier = i >= 78 && a >= 75 ? 1.10 : i >= 70 && a >= 70 ? 1.07 : 1.04;
    score *= multiplier;
  }

  // ── 6. SIGNAL DIVERGENCE PENALTY ─────────────────────────────────────────
  // Conflicting signals = unstable setup / fake breakout risk.
  let divergencePenalty = 0;
  if (i > 72 && a < 45) divergencePenalty += i > 82 ? 10 : 7;   // INS high, ACS absent
  if (c > 72 && i < 45) divergencePenalty += c > 82 ? 12 : 8;   // COS high, INS fading
  if (a > 68 && v < 38) divergencePenalty += 6;                  // ACS high, VQS weak
  score -= divergencePenalty;

  // ── 7. SIGNAL AGREEMENT BONUS ────────────────────────────────────────────
  // All major signals aligned = high-conviction opportunity.
  if (i > 70 && a > 70 && c > 70 && v > 60) {
    const bonus = i > 80 && a > 80 ? 8 : i > 75 && a > 75 ? 6 : 3;
    score += bonus;
  }

  // ── 8. CATALYST PROBABILITY BONUS ────────────────────────────────────────
  // High CPE + COS not yet extended = market underpricing a real setup.
  // Small additive bonus only — CPE is confirmatory, not a primary driver.
  if (cpe > 72 && c < 65) {
    const bonus = cpe > 85 ? 5 : cpe > 78 ? 3 : 2;
    score += bonus;
  }

  // ── 9. REGIME AWARENESS ───────────────────────────────────────────────────
  // SPY trend and volatility adjust the final score directionally.
  let regimeMultiplier: number;
  if (regime === "RISK-ON MOMENTUM") {
    regimeMultiplier = 1.07;                              // Bull: favor INS + COS
  } else if (regime === "QUALITY GROWTH") {
    regimeMultiplier = 1.03;
  } else if (regime === "DEFENSIVE MARKET") {
    regimeMultiplier = 0.90;                              // Bear: penalize COS-driven
    if (c > 65 && v < 50) score -= 5;                    // extra for weak-quality melt-ups
  } else if (regime === "HIGH VOLATILITY / UNSTABLE") {
    regimeMultiplier = 0.88;                              // Choppy: require ACS confirmation
    if (c > 65) score -= 5;
    if (a < 55) score -= 3;
  } else {
    regimeMultiplier = 0.97;                              // NEUTRAL / UNKNOWN
  }
  score *= regimeMultiplier;

  const finalScore = Math.round(clamp(score, 1, 100));
  return { csos: finalScore, csosLabel: csosLabelText(finalScore, v, i, a, c, cpe) };
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
  // ── CSOS — watchlist-only composite opportunity score ─────────────────────
  csos: number;
  csosLabel: string;
  // ── CPE — Catalyst Probability Engine (watchlist-only) ───────────────────
  cpe: number;
}

// ── Master score computation ───────────────────────────────────────────────────

export function computeScore(
  ticker: string,
  ext: ExtendedMetrics,
  currentPrice: number,
  changePercent = 0,
  quote?: QuoteData,
): StockScore {
  try {
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

  // ── ACCUMULATION CONFIDENCE SCORE (ACSv2) ────────────────────────────────
  // ACSv2 uses candle-based volume structure, RS persistence vs SPY,
  // closing strength, volatility compression, and liquidity quality.
  // spyCloses is already loaded by getSpyCloses60d() (Phase 7 — no extra calls).
  const acs = computeACS_v2(ext, quote, spyCloses);

  // ── FALSE BREAKOUT RISK SCORE ─────────────────────────────────────────────
  const fbrs = computeFBRS(ext, quote);

  // ── MULTI-TIMEFRAME TREND ─────────────────────────────────────────────────
  const trendLabel = computeTrendLabel(ext, quote);

  // ── CONVICTION TIER + SUPERSTOCK ─────────────────────────────────────────
  const convictionTier = computeConvictionTier(ins, cos, acs, fbrs);
  const isSuperstock   = computeSuperstock(ins, acs, fbrs);

  // ── CPE — Catalyst Probability Engine (watchlist-only) ───────────────────
  const cpe = calculateCPE(vqs, gvs, ins, acs, cos, fbrs);

  // ── CSOS — watchlist-only composite opportunity score ─────────────────────
  // Fetch the current market regime so CSOS can apply the regime multiplier.
  const { regime } = getMarketRegime();
  const csosResult = calculateCSOS(vqs, gvs, ins, acs, cos, regime, cpe);

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
    csos:      csosResult.csos,
    csosLabel: csosResult.csosLabel,
    cpe,
  };
  } catch (err) {
    logger.error({ ticker, err }, "computeScore threw unexpectedly — returning safe defaults");
    return {
      ticker,
      vqs: 0, gvs: 0, cos: 0,
      vqsLabel: "Weak Fundamentals",
      gvsLabel: "Broken Growth Story",
      cosLabel: "Avoid / High Risk",
      acs: 0, fbrs: 100,
      trendLabel: "NEUTRAL",
      convictionTier: 0,
      isSuperstock: false,
      csos: 0,
      csosLabel: "LOW QUALITY / AVOID",
      cpe: 0,
    };
  }
}

// ── Cross-sectional normalization ─────────────────────────────────────────────
// After all stocks in the universe are scored individually, this pass converts
// CSOS and CPE to percentile ranks within the active watchlist universe.
//
// Purpose: prevent score inflation/deflation across regimes. Ensures that
// 90+ CSOS scores remain rare (true elite setups) regardless of absolute
// market conditions. Elite distribution enforced:
//   90–100 = exceptional (top ~10%)
//   75–89  = strong opportunity
//   50–74  = solid / neutral
//   <50    = weak edge
//
// Only CSOS and CPE are normalized. Underlying signals (VQS, GVS, INS, ACS,
// COS) keep their absolute values so tooltips and individual thresholds are
// not disrupted.

export function normalizeScores(scores: StockScore[]): StockScore[] {
  if (scores.length < 2) return scores;

  const csosVals = scores.map(s => s.csos);
  const cpeVals  = scores.map(s => s.cpe);

  // Percentile rank: fraction of the universe strictly below this value,
  // mapped to 1–100. Ties receive the same rank (first-occurrence wins).
  function toPercentile(sorted: number[], val: number): number {
    const rank = sorted.filter(v => v < val).length + 1;  // 1-indexed
    return Math.round(clamp((rank / sorted.length) * 100, 1, 100));
  }

  const csosSorted = [...csosVals].sort((a, b) => a - b);
  const cpeSorted  = [...cpeVals].sort((a, b) => a - b);

  return scores.map(s => {
    const normCsos = toPercentile(csosSorted, s.csos);
    const normCpe  = toPercentile(cpeSorted,  s.cpe);
    return {
      ...s,
      csos:      normCsos,
      cpe:       normCpe,
      // Recompute label using normalized CSOS + raw signals for accuracy
      csosLabel: csosLabelText(normCsos, s.vqs, s.ins ?? 50, s.acs, s.cos, normCpe),
    };
  });
}
