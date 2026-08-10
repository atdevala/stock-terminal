import type { FactorDefinition, SignalInput, SignalOutput } from "@workspace/market-platform";
import type { StockScore } from "../lib/scores";
import { marketDataBus } from "./market-data-bus";
import { toInstrumentId, toSignalOutput } from "./normalizers";
import { signalRegistry } from "./registries";

type LegacyScoreKey = keyof Pick<
  StockScore,
  "vqs" | "gvs" | "cos" | "ins" | "acs" | "csos" | "cpe" | "bps" | "lqs"
>;

export const legacyFactorDefinitions: FactorDefinition[] = [
  legacyFactor("vqs", "Velocity Quality Score", "vqs"),
  legacyFactor("gvs", "Growth Vector Score", "gvs"),
  legacyFactor("cos", "Conviction Overlay Score", "cos"),
  legacyFactor("ins", "Inflection Signal", "ins"),
  legacyFactor("acs", "Accumulation Composite Score", "acs"),
  legacyFactor("csos", "Catalyst Signal Opportunity Score", "csos"),
  legacyFactor("cpe", "Catalyst Probability Engine", "cpe"),
  legacyFactor("bps", "Breakout Probability Score", "bps"),
  legacyFactor("lqs", "Liquidity Quality Score", "lqs"),
];

for (const factor of legacyFactorDefinitions) {
  signalRegistry.registerFactor(factor);
}

export function buildLegacySignalInput(score: StockScore): SignalInput {
  return {
    instrument: toInstrumentId(score.ticker),
    timeframe: "1d",
    snapshot: {},
    context: {
      legacyScore: score,
    },
  };
}

export function evaluateLegacyFactors(score: StockScore): Record<string, number> {
  const input = buildLegacySignalInput(score);
  const factors: Record<string, number> = {};

  for (const factor of signalRegistry.listFactors()) {
    factors[factor.id] = factor.compute(input);
  }

  return factors;
}

export async function publishLegacyScoreEvents(scores: StockScore[]): Promise<void> {
  for (const score of scores) {
    const signal = toSignalOutput(score);
    await publishLegacySignalEvent(score, signal);
  }
}

async function publishLegacySignalEvent(score: StockScore, signal: SignalOutput): Promise<void> {
  await marketDataBus.publish({
    id: `legacy-signal:${score.ticker}:${Date.now()}`,
    type: "signal.updated",
    ts: Date.now(),
    instrument: toInstrumentId(score.ticker),
    payload: {
      signal,
      factors: evaluateLegacyFactors(score),
      source: "legacy-computeScore",
    },
  });
}

function legacyFactor(id: string, label: string, key: LegacyScoreKey): FactorDefinition {
  return {
    id,
    label,
    weight: 1,
    compute(input) {
      const score = input.context?.["legacyScore"];
      if (!isLegacyScore(score)) return 50;
      const value = score[key];
      return typeof value === "number" && Number.isFinite(value) ? value : 50;
    },
  };
}

function isLegacyScore(value: unknown): value is StockScore {
  return typeof value === "object" && value !== null && "ticker" in value;
}
