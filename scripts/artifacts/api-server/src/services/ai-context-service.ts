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
        ...scoreFacts(score),
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
    return {
      id: `options-reasoning:${ticker}:${Date.now()}`,
      kind: "options-reasoning",
      ts: Date.now(),
      instruments: [toInstrumentId(ticker)],
      facts: [
        { key: "ticker", value: ticker, source: "request" },
        { key: "optionsDataStatus", value: "provider-not-connected", source: "options-engine" },
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

function scoreFacts(score: StockScore | undefined): Array<{ key: string; value: string | number | boolean; source?: string }> {
  if (!score) return [{ key: "scoreStatus", value: "unavailable", source: "score-service" }];

  return [
    { key: "ins", value: score.ins ?? 50, source: "legacy-score" },
    { key: "cos", value: score.cos, source: "legacy-score" },
    { key: "gvs", value: score.gvs, source: "legacy-score" },
    { key: "vqs", value: score.vqs, source: "legacy-score" },
    { key: "acs", value: score.acs, source: "legacy-score" },
    { key: "csos", value: score.csos, source: "legacy-score" },
    { key: "cpe", value: score.cpe, source: "legacy-score" },
    { key: "bps", value: score.bps, source: "legacy-score" },
    { key: "lqs", value: score.lqs, source: "legacy-score" },
    { key: "trendLabel", value: score.trendLabel, source: "legacy-score" },
    { key: "convictionTier", value: score.convictionTier, source: "legacy-score" },
    { key: "isSuperstock", value: score.isSuperstock, source: "legacy-score" },
  ];
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
