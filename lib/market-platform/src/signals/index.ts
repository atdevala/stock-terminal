import type { InstrumentId, Timeframe } from "../core";
import type { MarketDataSnapshot } from "../data";

export type SignalDirection = "bullish" | "bearish" | "neutral";

export interface SignalInput {
  instrument: InstrumentId;
  timeframe: Timeframe;
  snapshot: MarketDataSnapshot;
  context?: Record<string, unknown>;
}

export interface SignalOutput {
  id: string;
  label: string;
  score: number;
  direction: SignalDirection;
  confidence: number;
  reasons: string[];
  diagnostics?: Record<string, unknown>;
}

export interface SignalDefinition {
  id: string;
  label: string;
  description: string;
  version: string;
  inputs: string[];
  compute(input: SignalInput): SignalOutput;
}

export interface FactorDefinition {
  id: string;
  label: string;
  weight: number;
  compute(input: SignalInput): number;
}

export interface StrategyDefinition {
  id: string;
  label: string;
  signalIds: string[];
  factorIds: string[];
  rank(outputs: SignalOutput[]): number;
}

export interface SignalRegistry {
  registerSignal(signal: SignalDefinition): void;
  registerFactor(factor: FactorDefinition): void;
  registerStrategy(strategy: StrategyDefinition): void;
  getSignal(id: string): SignalDefinition | undefined;
  listSignals(): SignalDefinition[];
}
