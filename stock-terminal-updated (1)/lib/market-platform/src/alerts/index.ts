import type { InstrumentId } from "../core";

export interface AlertRule {
  id: string;
  name: string;
  instrument?: InstrumentId;
  expression: string;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ts: number;
  message: string;
  payload?: Record<string, unknown>;
}
