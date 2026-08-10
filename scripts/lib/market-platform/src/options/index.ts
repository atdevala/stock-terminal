import type { InstrumentId, Timestamped } from "../core";

export type OptionRight = "call" | "put";

export interface OptionContract {
  underlying: InstrumentId;
  symbol: string;
  expiration: string;
  strike: number;
  right: OptionRight;
  multiplier: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho?: number;
}

export interface OptionContractSnapshot extends Timestamped {
  contract: OptionContract;
  bid?: number;
  ask?: number;
  mark?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  greeks?: Greeks;
}

export interface OptionsChain {
  underlying: InstrumentId;
  expirations: string[];
  contracts: OptionContractSnapshot[];
  ts: number;
}

export interface VolatilitySurface {
  underlying: InstrumentId;
  ts: number;
  points: Array<{ expiration: string; strike: number; right: OptionRight; impliedVolatility: number }>;
}

export interface DealerExposure {
  underlying: InstrumentId;
  ts: number;
  gammaExposure: number;
  vannaExposure: number;
  charmExposure: number;
  maxPain?: number;
}

export interface OptionsAnalyticsEngine {
  buildVolatilitySurface(chain: OptionsChain): VolatilitySurface;
  calculateDealerExposure(chain: OptionsChain): DealerExposure;
  detectUnusualFlow(chain: OptionsChain): OptionContractSnapshot[];
}

export interface GreeksCalculator {
  calculate(contract: OptionContract, inputs: { underlyingPrice: number; impliedVolatility: number; riskFreeRate: number; daysToExpiration: number }): Greeks;
}

export interface VolatilityEngine {
  ivRank(surface: VolatilitySurface, lookbackDays: number): number;
  expectedMove(chain: OptionsChain): number;
}

export interface DealerExposureEngine {
  calculate(chain: OptionsChain): DealerExposure;
}

export interface FlowAnalysisEngine {
  detectUnusualActivity(chain: OptionsChain): OptionContractSnapshot[];
}

export interface StrategyBuilder {
  priceStrategy(legs: Array<{ contract: OptionContract; quantity: number; side: "buy" | "sell" }>): { maxProfit?: number; maxLoss?: number; breakevens: number[] };
}
