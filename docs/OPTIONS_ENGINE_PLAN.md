# Options Engine Plan

## Executive Summary

Options intelligence should become a core platform domain, not a dashboard add-on. The first implementation should define normalized contracts and engine ports before adding complex math. This prevents the common failure mode where chains, Greeks, flow, IV surfaces, and payoff charts each become separate incompatible features.

## P0 Requirements

### Normalized Option Contracts

Add provider-independent models for:

- underlying symbol
- expiration
- strike
- right: call or put
- bid, ask, mark, last
- volume, open interest
- implied volatility
- Greeks
- provider metadata

Implemented foundation:

- `OptionContract`
- `OptionContractSnapshot`
- `OptionsChain`
- `Greeks`

### Engine Interfaces

Implemented foundation:

- `OptionsAnalyticsEngine`
- `GreeksCalculator`
- `VolatilityEngine`
- `DealerExposureEngine`
- `FlowAnalysisEngine`
- `StrategyBuilder`

These are contracts only. The next step is provider normalization and tests.

### Data Quality Rules

Options analytics are dangerous when stale or sparse. Every options response should expose:

- quote timestamp
- provider
- stale flag
- missing bid/ask handling
- underlying quote timestamp
- calculation assumptions

## P1 Analytics Roadmap

### Volatility

- IV rank
- IV percentile
- term structure
- skew by delta and strike
- realized volatility comparison
- expected move
- probability cones

### Greeks

- Black-Scholes baseline
- dividend and rate assumptions
- portfolio Greek aggregation
- scenario shocks
- charm and vanna approximations after baseline is tested

### Dealer Exposure

- gamma exposure
- vanna exposure
- charm exposure
- call wall and put wall
- zero gamma level
- max pain
- open interest changes

### Flow

- unusual volume
- volume versus open interest
- sweep/block classification if provider supports it
- premium ranking
- side inference with bid/ask context
- expiration clustering

## P2 UX Roadmap

- Options chain panel with liquidity and IV filters.
- Strategy builder with payoff chart.
- Volatility surface view.
- Dealer exposure panel.
- Flow tape with explanation tags.
- AI-generated options setup summary based on structured data, not a generic chatbot.

## Migration Order

1. Add options contracts and engine interfaces.
2. Add provider capability flags for `optionsChains`.
3. Add provider contract tests using recorded sample chains.
4. Add normalized options endpoint.
5. Add basic chain panel.
6. Add IV rank and expected move.
7. Add Greeks and payoff engine.
8. Add dealer exposure and flow analytics.

## Risks

- Free data providers may not include sufficient options depth.
- Real-time options chains are payload-heavy.
- Incorrect Greeks or stale IV can mislead users.
- Dealer exposure models require clear assumptions and should never be presented as certainty.

