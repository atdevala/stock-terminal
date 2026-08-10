import type {
  FactorRegistry,
  FactorDefinition,
  IndicatorDefinition,
  IndicatorRegistry,
  SignalDefinition,
  SignalRegistry,
  StrategyRegistry,
  StrategyDefinition,
} from "@workspace/market-platform";

export class InMemorySignalRegistry implements SignalRegistry, FactorRegistry, StrategyRegistry {
  private readonly signals = new Map<string, SignalDefinition>();
  private readonly factors = new Map<string, FactorDefinition>();
  private readonly strategies = new Map<string, StrategyDefinition>();

  registerSignal(signal: SignalDefinition): void {
    this.signals.set(signal.id, signal);
  }

  registerFactor(factor: FactorDefinition): void {
    this.factors.set(factor.id, factor);
  }

  registerStrategy(strategy: StrategyDefinition): void {
    this.strategies.set(strategy.id, strategy);
  }

  getSignal(id: string): SignalDefinition | undefined {
    return this.signals.get(id);
  }

  listSignals(): SignalDefinition[] {
    return [...this.signals.values()];
  }

  getFactor(id: string): FactorDefinition | undefined {
    return this.factors.get(id);
  }

  listFactors(): FactorDefinition[] {
    return [...this.factors.values()];
  }

  getStrategy(id: string): StrategyDefinition | undefined {
    return this.strategies.get(id);
  }

  listStrategies(): StrategyDefinition[] {
    return [...this.strategies.values()];
  }
}

export class InMemoryIndicatorRegistry implements IndicatorRegistry {
  private readonly indicators = new Map<string, IndicatorDefinition>();

  register(indicator: IndicatorDefinition): void {
    this.indicators.set(indicator.id, indicator);
  }

  get(id: string): IndicatorDefinition | undefined {
    return this.indicators.get(id);
  }

  list(): IndicatorDefinition[] {
    return [...this.indicators.values()];
  }
}

export const signalRegistry = new InMemorySignalRegistry();
export const indicatorRegistry = new InMemoryIndicatorRegistry();
