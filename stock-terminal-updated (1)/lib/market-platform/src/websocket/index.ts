import type { Candle, CorporateEvent, Quote } from "../data";
import type { InstrumentId } from "../core";
import type { OptionContractSnapshot } from "../options";

export type MarketEventType =
  | "quote.updated"
  | "candle.closed"
  | "fundamentals.updated"
  | "option.updated"
  | "news.received"
  | "signal.updated"
  | "provider.status";

export interface MarketEvent<TPayload = unknown> {
  id: string;
  type: MarketEventType;
  ts: number;
  provider?: string;
  instrument?: InstrumentId;
  payload: TPayload;
}

export type MarketEventPayload =
  | Quote
  | Candle
  | CorporateEvent
  | OptionContractSnapshot
  | Record<string, unknown>;

export type MarketEventHandler<TPayload = unknown> = (event: MarketEvent<TPayload>) => void | Promise<void>;

export interface MarketDataBus {
  publish<TPayload>(event: MarketEvent<TPayload>): Promise<void>;
  subscribe<TPayload = unknown>(type: MarketEventType, handler: MarketEventHandler<TPayload>): () => void;
}

export interface StreamingSubscription {
  id: string;
  provider: string;
  instruments: InstrumentId[];
  eventTypes: MarketEventType[];
  status: "connecting" | "active" | "degraded" | "closed";
}
