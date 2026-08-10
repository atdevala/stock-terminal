import type {
  MarketDataBus,
  MarketEvent,
  MarketEventHandler,
  MarketEventType,
} from "@workspace/market-platform";
import { logger } from "../lib/logger";

export class InMemoryMarketDataBus implements MarketDataBus {
  private readonly handlers = new Map<MarketEventType, Set<MarketEventHandler<unknown>>>();

  async publish<TPayload>(event: MarketEvent<TPayload>): Promise<void> {
    const eventHandlers = this.handlers.get(event.type);
    if (!eventHandlers || eventHandlers.size === 0) return;

    for (const handler of eventHandlers) {
      try {
        await handler(event as MarketEvent<unknown>);
      } catch (err) {
        logger.warn({ err, eventType: event.type, eventId: event.id }, "Market data bus handler failed");
      }
    }
  }

  subscribe<TPayload = unknown>(
    type: MarketEventType,
    handler: MarketEventHandler<TPayload>,
  ): () => void {
    const existing = this.handlers.get(type) ?? new Set<MarketEventHandler<unknown>>();
    existing.add(handler as MarketEventHandler<unknown>);
    this.handlers.set(type, existing);

    return () => {
      existing.delete(handler as MarketEventHandler<unknown>);
      if (existing.size === 0) this.handlers.delete(type);
    };
  }
}

export const marketDataBus = new InMemoryMarketDataBus();
