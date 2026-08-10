import type {
  DealerExposure,
  DealerExposureEngine,
  FlowAnalysisEngine,
  Greeks,
  GreeksCalculator,
  OptionContract,
  OptionContractSnapshot,
  OptionsAnalyticsEngine,
  OptionsChain,
  StrategyBuilder,
  VolatilityEngine,
  VolatilitySurface,
} from "@workspace/market-platform";

const DAYS_PER_YEAR = 365;

export class BlackScholesGreeksCalculator implements GreeksCalculator {
  calculate(
    contract: OptionContract,
    inputs: {
      underlyingPrice: number;
      impliedVolatility: number;
      riskFreeRate: number;
      daysToExpiration: number;
    },
  ): Greeks {
    const spot = positive(inputs.underlyingPrice);
    const strike = positive(contract.strike);
    const vol = positive(inputs.impliedVolatility);
    const rate = Number.isFinite(inputs.riskFreeRate) ? inputs.riskFreeRate : 0;
    const years = Math.max(inputs.daysToExpiration, 1) / DAYS_PER_YEAR;

    const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * Math.sqrt(years));
    const d2 = d1 - vol * Math.sqrt(years);
    const pdfD1 = normalPdf(d1);
    const callDelta = normalCdf(d1);
    const putDelta = callDelta - 1;

    const delta = contract.right === "call" ? callDelta : putDelta;
    const gamma = pdfD1 / (spot * vol * Math.sqrt(years));
    const vega = spot * pdfD1 * Math.sqrt(years) / 100;
    const callTheta =
      (-(spot * pdfD1 * vol) / (2 * Math.sqrt(years)) - rate * strike * Math.exp(-rate * years) * normalCdf(d2)) / DAYS_PER_YEAR;
    const putTheta =
      (-(spot * pdfD1 * vol) / (2 * Math.sqrt(years)) + rate * strike * Math.exp(-rate * years) * normalCdf(-d2)) / DAYS_PER_YEAR;
    const callRho = (strike * years * Math.exp(-rate * years) * normalCdf(d2)) / 100;
    const putRho = (-strike * years * Math.exp(-rate * years) * normalCdf(-d2)) / 100;

    return {
      delta: round(delta),
      gamma: round(gamma),
      theta: round(contract.right === "call" ? callTheta : putTheta),
      vega: round(vega),
      rho: round(contract.right === "call" ? callRho : putRho),
    };
  }
}

export class BasicVolatilityEngine implements VolatilityEngine {
  ivRank(surface: VolatilitySurface, _lookbackDays: number): number {
    const ivs = surface.points.map(point => point.impliedVolatility).filter(Number.isFinite);
    if (ivs.length === 0) return 0;
    const min = Math.min(...ivs);
    const max = Math.max(...ivs);
    const latest = ivs[ivs.length - 1] ?? min;
    if (max === min) return 50;
    return Math.round(((latest - min) / (max - min)) * 100);
  }

  expectedMove(chain: OptionsChain): number {
    const expirations = [...chain.expirations].sort();
    const frontExpiration = expirations[0];
    if (!frontExpiration) return 0;

    const frontContracts = chain.contracts.filter(contract => contract.contract.expiration === frontExpiration);
    const strikes = [...new Set(frontContracts.map(contract => contract.contract.strike))].sort((a, b) => a - b);
    const midpointStrike = strikes[Math.floor(strikes.length / 2)];
    if (!midpointStrike) return 0;

    const call = frontContracts.find(contract => contract.contract.strike === midpointStrike && contract.contract.right === "call");
    const put = frontContracts.find(contract => contract.contract.strike === midpointStrike && contract.contract.right === "put");
    return round(optionMid(call) + optionMid(put));
  }
}

export class BasicDealerExposureEngine implements DealerExposureEngine {
  calculate(chain: OptionsChain): DealerExposure {
    let gammaExposure = 0;
    let vannaExposure = 0;
    let charmExposure = 0;
    const strikePain = new Map<number, number>();

    for (const snapshot of chain.contracts) {
      const openInterest = snapshot.openInterest ?? 0;
      const multiplier = snapshot.contract.multiplier || 100;
      const sign = snapshot.contract.right === "call" ? 1 : -1;
      const gamma = snapshot.greeks?.gamma ?? 0;
      const vega = snapshot.greeks?.vega ?? 0;
      const theta = snapshot.greeks?.theta ?? 0;

      gammaExposure += sign * gamma * openInterest * multiplier;
      vannaExposure += sign * vega * openInterest * multiplier;
      charmExposure += sign * theta * openInterest * multiplier;
      strikePain.set(snapshot.contract.strike, (strikePain.get(snapshot.contract.strike) ?? 0) + openInterest);
    }

    return {
      underlying: chain.underlying,
      ts: chain.ts,
      gammaExposure: round(gammaExposure),
      vannaExposure: round(vannaExposure),
      charmExposure: round(charmExposure),
      maxPain: largestOpenInterestStrike(strikePain),
    };
  }
}

export class BasicFlowAnalysisEngine implements FlowAnalysisEngine {
  detectUnusualActivity(chain: OptionsChain): OptionContractSnapshot[] {
    return chain.contracts
      .filter(snapshot => {
        const volume = snapshot.volume ?? 0;
        const openInterest = snapshot.openInterest ?? 0;
        const premium = optionMid(snapshot) * volume * (snapshot.contract.multiplier || 100);
        return volume >= 500 && (openInterest === 0 || volume / openInterest >= 2) && premium >= 100_000;
      })
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  }
}

export class BasicStrategyBuilder implements StrategyBuilder {
  priceStrategy(
    legs: Array<{ contract: OptionContract; quantity: number; side: "buy" | "sell" }>,
  ): { maxProfit?: number; maxLoss?: number; breakevens: number[] } {
    const strikes = legs.map(leg => leg.contract.strike).sort((a, b) => a - b);
    const width = strikes.length >= 2 ? Math.max(...strikes) - Math.min(...strikes) : undefined;
    const netContracts = legs.reduce((sum, leg) => sum + (leg.side === "buy" ? leg.quantity : -leg.quantity), 0);

    return {
      maxProfit: width ? round(Math.max(width * 100 * Math.abs(netContracts || 1), 0)) : undefined,
      maxLoss: width ? round(Math.max(width * 100 * Math.abs(netContracts || 1), 0)) : undefined,
      breakevens: [...new Set(strikes)],
    };
  }
}

export class BasicOptionsAnalyticsEngine implements OptionsAnalyticsEngine {
  constructor(
    private readonly dealerExposureEngine: DealerExposureEngine,
    private readonly flowAnalysisEngine: FlowAnalysisEngine,
  ) {}

  buildVolatilitySurface(chain: OptionsChain): VolatilitySurface {
    return {
      underlying: chain.underlying,
      ts: chain.ts,
      points: chain.contracts
        .filter(snapshot => typeof snapshot.impliedVolatility === "number")
        .map(snapshot => ({
          expiration: snapshot.contract.expiration,
          strike: snapshot.contract.strike,
          right: snapshot.contract.right,
          impliedVolatility: snapshot.impliedVolatility!,
        })),
    };
  }

  calculateDealerExposure(chain: OptionsChain): DealerExposure {
    return this.dealerExposureEngine.calculate(chain);
  }

  detectUnusualFlow(chain: OptionsChain): OptionContractSnapshot[] {
    return this.flowAnalysisEngine.detectUnusualActivity(chain);
  }
}

export const greeksCalculator = new BlackScholesGreeksCalculator();
export const volatilityEngine = new BasicVolatilityEngine();
export const dealerExposureEngine = new BasicDealerExposureEngine();
export const flowAnalysisEngine = new BasicFlowAnalysisEngine();
export const strategyBuilder = new BasicStrategyBuilder();
export const optionsAnalyticsEngine = new BasicOptionsAnalyticsEngine(dealerExposureEngine, flowAnalysisEngine);

function optionMid(snapshot: OptionContractSnapshot | undefined): number {
  if (!snapshot) return 0;
  if (typeof snapshot.mark === "number") return snapshot.mark;
  if (typeof snapshot.bid === "number" && typeof snapshot.ask === "number") return (snapshot.bid + snapshot.ask) / 2;
  return snapshot.last ?? 0;
}

function largestOpenInterestStrike(strikes: Map<number, number>): number | undefined {
  let bestStrike: number | undefined;
  let bestOpenInterest = -1;
  for (const [strike, openInterest] of strikes.entries()) {
    if (openInterest > bestOpenInterest) {
      bestStrike = strike;
      bestOpenInterest = openInterest;
    }
  }
  return bestStrike;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0.0001;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalPdf(value: number): number {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
