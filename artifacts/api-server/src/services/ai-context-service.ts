import type {
  AIContextBuilder,
  AIContextPacket,
  AIWorkflowKind,
  MarketMemoryStore,
  RetrievalDocument,
  SignalOutput,
} from "@workspace/market-platform";
import type { StockScore } from "../lib/scores";
import { marketDataService } from "./market-data-service";
import { toInstrumentId, toSignalOutput } from "./normalizers";
import { scoreService } from "./score-service";

export class StructuredAIContextBuilder implements AIContextBuilder {
  async build(packet: AIContextPacket): Promise<string> {
    const instruments = packet.instruments.map(instrument => instrument.symbol).join(", ");
    const signals = packet.signals?.map(signal => `${signal.label}: ${signal.score}`).join("; ") ?? "none";
    const facts = packet.facts
      .map(fact => `- ${fact.key}: ${fact.value}${fact.source ? ` (${fact.source})` : ""}`)
      .join("\n");
    const constraints = packet.constraints?.map(item => `- ${item}`).join("\n") ?? "- No unstated assumptions";

    return [
      `Workflow: ${packet.kind}`,
      `Timestamp: ${new Date(packet.ts).toISOString()}`,
      `Instruments: ${instruments}`,
      `Signals: ${signals}`,
      "Facts:",
      facts || "- none",
      "Constraints:",
      constraints,
      packet.userIntent ? `User intent: ${packet.userIntent}` : undefined,
    ].filter(Boolean).join("\n");
  }
}

export class InMemoryMarketMemoryStore implements MarketMemoryStore {
  private readonly documents = new Map<string, RetrievalDocument>();

  async upsert(document: RetrievalDocument): Promise<void> {
    this.documents.set(document.id, document);
  }

  async search(query: string, filters?: Record<string, string | number | boolean>): Promise<RetrievalDocument[]> {
    const q = query.toLowerCase();
    return [...this.documents.values()]
      .filter(document => document.text.toLowerCase().includes(q) || document.id.toLowerCase().includes(q))
      .filter(document => matchesFilters(document, filters))
      .sort((a, b) => b.ts - a.ts);
  }
}

export const aiContextBuilder = new StructuredAIContextBuilder();
export const marketMemoryStore = new InMemoryMarketMemoryStore();

export const aiContextService = {
  buildTickerSignalPacket(ticker: string, intent = "Explain the current ticker setup"): AIContextPacket {
    const score = scoreService.computeScores().find(item => item.ticker === ticker);
    const quote = marketDataService.getQuote(ticker);
    const signal = score ? toSignalOutput(score) : undefined;

    return {
      id: `ticker-signal:${ticker}:${Date.now()}`,
      kind: "screener-explanation",
      ts: Date.now(),
      instruments: [toInstrumentId(ticker)],
      signals: signal ? [signal] : undefined,
      facts: [
        { key: "ticker", value: ticker, source: "request" },
        { key: "price", value: quote?.price ?? "unavailable", source: "quote-cache" },
        { key: "dayChangePercent", value: quote?.changePercent ?? "unavailable", source: "quote-cache" },
        ...scoreFacts(score, ticker),
      ],
      constraints: defaultAIConstraints(),
      userIntent: intent,
    };
  },

  buildWatchlistBriefPacket(intent = "Summarize watchlist signal leadership"): AIContextPacket {
    const scores = scoreService.computeScores();
    const topSignals = scores
      .sort((a, b) => (b.ins ?? 0) - (a.ins ?? 0))
      .slice(0, 10)
      .map(toSignalOutput);

    return {
      id: `watchlist-brief:${Date.now()}`,
      kind: "trade-summary",
      ts: Date.now(),
      instruments: scores.slice(0, 25).map(score => toInstrumentId(score.ticker)),
      signals: topSignals,
      facts: [
        { key: "scoredSymbols", value: scores.length, source: "score-service" },
        { key: "marketSession", value: marketDataService.getMarketStatus().session, source: "market-status" },
        { key: "marketRegime", value: marketDataService.getMarketRegime().regime, source: "market-regime" },
      ],
      constraints: defaultAIConstraints(),
      userIntent: intent,
    };
  },

  buildOptionsReasoningPacket(ticker: string, intent = "Explain an options setup from structured options analytics"): AIContextPacket {
    const score = scoreService.computeScores().find(item => item.ticker === ticker);
    const quote = marketDataService.getQuote(ticker);

    return {
      id: `options-reasoning:${ticker}:${Date.now()}`,
      kind: "options-reasoning",
      ts: Date.now(),
      instruments: [toInstrumentId(ticker)],
      facts: [
        { key: "ticker", value: ticker, source: "request" },
        { key: "price", value: quote?.price ?? "unavailable", source: "quote-cache" },
        { key: "dayChangePercent", value: quote?.changePercent ?? "unavailable", source: "quote-cache" },
        { key: "optionsDataStatus", value: "provider-not-connected", source: "options-engine" },
        ...scoreFacts(score, ticker),
      ],
      constraints: [
        ...defaultAIConstraints(),
        "Do not infer options flow, IV rank, Greeks, or dealer exposure without normalized options-chain data.",
      ],
      userIntent: intent,
    };
  },

  async render(packet: AIContextPacket): Promise<string> {
    return aiContextBuilder.build(packet);
  },

  remember(document: RetrievalDocument): Promise<void> {
    return marketMemoryStore.upsert(document);
  },

  searchMemory(query: string, filters?: Record<string, string | number | boolean>): Promise<RetrievalDocument[]> {
    return marketMemoryStore.search(query, filters);
  },
};

// COS/CSOS/CPE/BPS are retired composite scores — never surfaced to a user
// or an AI prompt as their own number (see StockRow.tsx for the frontend
// side of this rule). trendLabel is retired too: it was a vague categorical
// bucket ("MID-TERM BREAKOUT" etc.) that added noise without adding
// information beyond what the real price-level facts below already say.
// Give the model actual numbers to reason about instead — 52-week range and
// moving-average price levels — so write-ups cite concrete levels rather
// than parroting a label.
function scoreFacts(score: StockScore | undefined, ticker?: string): Array<{ key: string; value: string | number | boolean; source?: string }> {
  if (!score) return [{ key: "scoreStatus", value: "unavailable", source: "score-service" }];

  const facts: Array<{ key: string; value: string | number | boolean; source?: string }> = [
    { key: "ins", value: score.ins ?? 50, source: "score-service" },
    { key: "gvs", value: score.gvs, source: "score-service" },
    { key: "vqs", value: score.vqs, source: "score-service" },
    { key: "acs", value: score.acs, source: "score-service" },
    { key: "fbrs", value: score.fbrs, source: "score-service" },
    { key: "lqs", value: score.lqs, source: "score-service" },
    // signalScore/signalLabel is the ONE consolidated composite the rest of
    // the app has settled on post-consolidation (see StockScore in scores.ts)
    // — csos/cpe/bps are the retired overlapping recombinations of the same
    // underlying primitives and are deliberately NOT sent here.
    { key: "signalScore", value: score.signalScore, source: "score-service" },
    { key: "signalLabel", value: score.signalLabel, source: "score-service" },
    { key: "convictionTier", value: score.convictionTier, source: "score-service" },
    { key: "isSuperstock", value: score.isSuperstock, source: "score-service" },
    // The exact gate flags the rest of the app already uses as the one shared
    // source of truth (signal-consistency.ts) — giving these directly lets
    // the model reason about "is this already extended" itself instead of
    // only inferring it from signalLabel's text.
    { key: "isExtended", value: score.isExtended, source: "score-service" },
    { key: "passesQualityFloor", value: score.passesQualityFloor, source: "score-service" },
  ];

  if (score.rsi !== undefined) facts.push({ key: "rsi14", value: score.rsi, source: "price-history" });
  if (score.high52 !== undefined) facts.push({ key: "high52Week", value: score.high52, source: "quote-cache" });
  if (score.low52 !== undefined) facts.push({ key: "low52Week", value: score.low52, source: "quote-cache" });
  if (score.ma50 !== undefined) facts.push({ key: "movingAverage50Day", value: score.ma50, source: "price-history" });
  if (score.ma200 !== undefined) facts.push({ key: "movingAverage200Day", value: score.ma200, source: "price-history" });
  if (score.priceAbove50MA !== undefined) facts.push({ key: "priceAbove50DayMA", value: score.priceAbove50MA, source: "price-history" });
  if (score.priceAbove200MA !== undefined) facts.push({ key: "priceAbove200DayMA", value: score.priceAbove200MA, source: "price-history" });

  // Fundamentals — already computed onto StockScore but never previously
  // surfaced to the model, despite VQS being partly built from them. Real
  // numbers instead of only the abstracted valuation/quality score.
  if (score.revenueGrowthYoy !== undefined) facts.push({ key: "revenueGrowthYoyPercent", value: score.revenueGrowthYoy, source: "fundamentals" });
  if (score.revenueGrowthQoQ !== undefined) facts.push({ key: "revenueGrowthQoQPercent", value: score.revenueGrowthQoQ, source: "fundamentals" });
  if (score.grossMargin !== undefined) facts.push({ key: "grossMarginPercent", value: score.grossMargin, source: "fundamentals" });
  if (score.operatingMargin !== undefined) facts.push({ key: "operatingMarginPercent", value: score.operatingMargin, source: "fundamentals" });
  if (score.pe !== undefined) facts.push({ key: "peRatio", value: score.pe, source: "fundamentals" });
  if (score.earningsRevisionsUp !== undefined) facts.push({ key: "analystRevisionsSkewUp", value: score.earningsRevisionsUp, source: "fundamentals" });

  // Relative volume vs. the trailing 20-day average, computed from the same
  // volumes60d series ACS already uses. Note this reflects the most recently
  // COMPLETED session, not intraday-so-far volume — Finnhub's free quote
  // endpoint doesn't return a live cumulative-volume figure, and volumes60d
  // is daily-candle data that (like closes60d, see appendLivePrice in
  // finnhub.ts) only finalizes once a session closes. Labeled accordingly so
  // the model doesn't overstate its freshness.
  const ext = ticker ? marketDataService.getExtendedMetrics(ticker) : undefined;
  const volumes = ext?.volumes60d;
  if (volumes && volumes.length >= 21) {
    const mostRecent = volumes[volumes.length - 1]!;
    const priorTwenty = volumes.slice(-21, -1);
    const avg20d = priorTwenty.reduce((a, b) => a + b, 0) / priorTwenty.length;
    if (avg20d > 0) {
      const relativeVolumePercent = Math.round((mostRecent / avg20d) * 100);
      facts.push({
        key: "mostRecentSessionVolumeVs20dAvgPercent",
        value: relativeVolumePercent,
        source: "price-history",
      });
    }
  }

  // Insider Form 3/4/5 transactions + monthly sentiment (MSPR) — verified live
  // against Finnhub's free tier before building this; short interest and
  // institutional (13-F) ownership both came back 403/premium-required on
  // this plan and are NOT wired in (see fetchInsiderActivity in finnhub.ts).
  // Summarized counts only, never the raw filing list.
  if (ext?.insiderBuys30d !== undefined || ext?.insiderSells30d !== undefined) {
    const buys = ext.insiderBuys30d ?? 0;
    const sells = ext.insiderSells30d ?? 0;
    facts.push({
      key: "insiderTransactions30d",
      value: `${buys} open-market buy${buys === 1 ? "" : "s"}, ${sells} sell${sells === 1 ? "" : "s"} (last 30 days)`,
      source: "finnhub-insider-transactions",
    });
  }
  if (ext?.insiderMspr !== undefined && ext?.insiderMsprMonth !== undefined) {
    facts.push({
      key: "insiderSentimentMspr",
      value: `${ext.insiderMspr} for ${ext.insiderMsprMonth} (Monthly Share Purchase Ratio: -100 = all selling, +100 = all buying)`,
      source: "finnhub-insider-sentiment",
    });
  }

  return facts;
}

function defaultAIConstraints(): string[] {
  return [
    "Use only the provided structured facts.",
    "Distinguish observation from inference.",
    "Mention missing or stale data explicitly.",
    "Do not promise returns or certainty.",
  ];
}

function matchesFilters(document: RetrievalDocument, filters?: Record<string, string | number | boolean>): boolean {
  if (!filters) return true;
  return Object.entries(filters).every(([key, value]) => document.metadata?.[key] === value);
}
