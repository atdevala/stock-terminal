import type { ExtendedMetrics } from "./finnhub";

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

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
}

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

  // Growth Score (0-20): Revenue YoY * 0.4
  const growthScore = clamp(rg * 0.4, 0, 20);

  // Valuation Score (0-20): 200/PE or 50/EV_Sales
  let valuationScore = 0;
  if (pe && pe > 0) {
    valuationScore = clamp(200 / pe, 0, 20);
  } else if (evS && evS > 0) {
    valuationScore = clamp(50 / evS, 0, 20);
  }

  // PEG Score (0-20)
  const peg = (pe && pe > 0 && rg > 0) ? pe / Math.max(rg, 1) : 0;
  const pegScore = peg > 0 ? clamp(20 / peg, 0, 20) : 0;

  // Margin Score (0-20)
  const marginScore = clamp((gm * 0.1) + (opM * 0.2), 0, 20);

  // Financial Health Score (0-20)
  let healthScore = 20;
  if (fcfM < 0)  healthScore -= 5;
  if (rg < 0)    healthScore -= 5;
  if (de > 2)    healthScore -= 5;
  healthScore = clamp(healthScore, 0, 20);

  const vqs = Math.round(clamp(growthScore + valuationScore + pegScore + marginScore + healthScore));

  // ── GROWTH VOLATILITY SCORE ───────────────────────────────────────────────

  // Growth Acceleration Score (0-25)
  const growthAccelScore = clamp((rg * 0.3) + (rgQ * 0.5), 0, 25);

  // Momentum Score (0-25): revisions + price vs MAs + intraday move
  // Intraday component: ±5 pts scaled to ±10% day change, so live price movement shifts GVS visibly
  const intradayPts = clamp(changePercent * 0.5, -5, 5);
  let momentumScore = 0;
  if (revisionsUp)      momentumScore += 15;
  if (priceAbove50MA)   momentumScore += 5;
  if (priceAbove200MA)  momentumScore += 5;
  momentumScore = clamp(momentumScore + intradayPts, 0, 25);

  // Valuation Efficiency Score (0-25): 25 / (PE / max(rgYoY, 1))
  let gvsValScore = 0;
  if (pe && pe > 0 && rg > 0) {
    const valAdj = pe / Math.max(rg, 1);
    gvsValScore = clamp(25 / Math.max(valAdj, 0.01), 0, 25);
  }

  // Profitability Optionality Score (0-25)
  const profScore = clamp((gm * 0.2) + (fcfM * 0.3), 0, 25);

  const gvs = Math.round(clamp(growthAccelScore + momentumScore + gvsValScore + profScore));

  // ── COMBINED OPPORTUNITY SCORE ────────────────────────────────────────────
  const cos = Math.round(clamp((0.5 * vqs) + (0.5 * gvs)));

  return {
    ticker,
    vqs, gvs, cos,
    vqsLabel: vqsLabel(vqs),
    gvsLabel: gvsLabel(gvs),
    cosLabel: cosLabel(cos),
    revenueGrowthYoy: ext.revenueGrowthYoy,
    revenueGrowthQoQ: ext.revenueGrowthQoQ,
    grossMargin:      ext.grossMargin,
    operatingMargin:  ext.operatingMargin,
    fcfMargin:        ext.fcfMargin,
    debtToEquity:     ext.debtToEquity,
    pe:               ext.pe,
    evSales:          ext.evSales,
    priceAbove50MA,
    priceAbove200MA,
    earningsRevisionsUp: revisionsUp,
  };
}
