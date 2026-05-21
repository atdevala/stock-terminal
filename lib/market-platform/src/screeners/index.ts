import type { InstrumentId } from "../core";
import type { SignalOutput } from "../signals";

export type ScreenerConditionOperator = ">" | ">=" | "<" | "<=" | "=" | "!=" | "between" | "in";

export interface ScreenerCondition {
  field: string;
  operator: ScreenerConditionOperator;
  value: number | string | boolean | Array<number | string>;
}

export interface ScreenerTemplate {
  id: string;
  name: string;
  description?: string;
  conditions: ScreenerCondition[];
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

export interface ScreenerResult {
  instrument: InstrumentId;
  rank: number;
  score: number;
  matchedSignals: SignalOutput[];
  explanation?: string;
}

export interface ScreenerEngine {
  run(template: ScreenerTemplate, universe: InstrumentId[]): Promise<ScreenerResult[]>;
}
