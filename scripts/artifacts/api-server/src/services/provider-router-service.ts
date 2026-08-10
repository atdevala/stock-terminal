import type {
  InstrumentId,
  MarketDataProvider,
  ProviderCapabilityMap,
  ProviderRouter,
} from "@workspace/market-platform";
import { marketDataProvider } from "./market-data-service";

export class StaticProviderRouter implements ProviderRouter {
  readonly primary: string;
  readonly fallbacks: string[];

  constructor(private readonly providers: MarketDataProvider[]) {
    this.primary = providers[0]?.id ?? "";
    this.fallbacks = providers.slice(1).map(provider => provider.id);
  }

  route(capability: keyof ProviderCapabilityMap, _instrument: InstrumentId): MarketDataProvider[] {
    return this.providers.filter(provider => provider.capabilities[capability]);
  }
}

export const providerRouter = new StaticProviderRouter([marketDataProvider]);
