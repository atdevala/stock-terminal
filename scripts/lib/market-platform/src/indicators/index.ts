import type { Candle } from "../data";

export interface IndicatorInput {
  candles: Candle[];
  parameters?: Record<string, number | string | boolean>;
}

export interface IndicatorPoint {
  ts: number;
  value: number;
  band?: "upper" | "middle" | "lower";
}

export interface IndicatorDefinition {
  id: string;
  label: string;
  category: "trend" | "momentum" | "volatility" | "volume" | "breadth" | "custom";
  defaultParameters: Record<string, number | string | boolean>;
  compute(input: IndicatorInput): IndicatorPoint[];
}

export interface IndicatorRegistry {
  register(indicator: IndicatorDefinition): void;
  get(id: string): IndicatorDefinition | undefined;
  list(): IndicatorDefinition[];
}
