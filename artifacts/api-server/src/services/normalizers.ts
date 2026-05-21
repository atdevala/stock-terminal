import type {
  FundamentalsSnapshot,
  InstrumentId,
  Quote,
  SignalOutput,
} from "@workspace/market-platform";
import type { ExtendedMetrics, QuoteData } from "../lib/finnhub";
import type { StockScore } from "../lib/scores";

export function toInstrumentId(symbol: string): InstrumentId {
  return {
    symbol,
    assetClass: "equity",
    exchange: "US",
    currency: "USD",
    providerSymbol: symbol,
  };
}

export function toPlatformQuote(quote: QuoteData): Quote {
  return {
    instrument: toInstrumentId(quote.ticker),
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    previousClose: quote.prevClose,
    session: "regular",
    volume: parseCompactNumber(quote.volume),
    ts: quote.lastUpdated,
  };
}

export function toFundamentalsSnapshot(metrics: ExtendedMetrics): FundamentalsSnapshot {
  return {
    instrument: toInstrumentId(metrics.ticker),
    revenueGrowthYoy: metrics.revenueGrowthYoy,
    revenueGrowthQoq: metrics.revenueGrowthQoQ,
    grossMargin: metrics.grossMargin,
    operatingMargin: metrics.operatingMargin,
    freeCashFlowMargin: metrics.fcfMargin,
    debtToEquity: metrics.debtToEquity,
    peRatio: metrics.pe,
    evToSales: metrics.evSales,
    ts: Date.now(),
  };
}

export function toSignalOutput(score: StockScore): SignalOutput {
  const composite = Math.round(((score.ins ?? 50) + score.cos + score.gvs + score.vqs + score.acs) / 5);

  return {
    id: `legacy-composite:${score.ticker}`,
    label: `${score.ticker} Legacy Composite`,
    score: composite,
    direction: composite >= 60 ? "bullish" : composite <= 40 ? "bearish" : "neutral",
    confidence: Math.min(100, Math.max(0, Math.abs(composite - 50) * 2)),
    reasons: [
      `INS ${score.ins ?? 50}`,
      `COS ${score.cos}`,
      `GVS ${score.gvs}`,
      `VQS ${score.vqs}`,
      `ACS ${score.acs}`,
    ],
    diagnostics: {
      source: "legacy-computeScore",
      ticker: score.ticker,
    },
  };
}

function parseCompactNumber(value: string | undefined): number | undefined {
  if (!value || value === "-") return undefined;
  const trimmed = value.trim().toUpperCase();
  const multiplier = trimmed.endsWith("B") ? 1e9 : trimmed.endsWith("M") ? 1e6 : trimmed.endsWith("K") ? 1e3 : 1;
  const numeric = Number(trimmed.replace(/[BMK]/g, ""));
  return Number.isFinite(numeric) ? numeric * multiplier : undefined;
}
