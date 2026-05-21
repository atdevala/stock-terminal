import type { InstrumentId } from "../core";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop-limit";

export interface OrderIntent {
  instrument: InstrumentId;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  rationale?: string;
}
