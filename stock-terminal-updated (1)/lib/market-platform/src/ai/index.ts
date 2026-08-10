import type { InstrumentId } from "../core";
import type { SignalOutput } from "../signals";

export type AIWorkflowKind =
  | "market-query"
  | "trade-summary"
  | "screener-explanation"
  | "chart-explanation"
  | "risk-review"
  | "portfolio-review"
  | "news-summary"
  | "options-reasoning";

export interface AIContextPacket {
  id: string;
  kind: AIWorkflowKind;
  ts: number;
  instruments: InstrumentId[];
  signals?: SignalOutput[];
  facts: Array<{ key: string; value: string | number | boolean; source?: string }>;
  constraints?: string[];
  userIntent?: string;
}

export interface RetrievalDocument {
  id: string;
  source: string;
  ts: number;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AIContextBuilder {
  build(packet: AIContextPacket): Promise<string>;
}

export interface MarketMemoryStore {
  upsert(document: RetrievalDocument): Promise<void>;
  search(query: string, filters?: Record<string, string | number | boolean>): Promise<RetrievalDocument[]>;
}
