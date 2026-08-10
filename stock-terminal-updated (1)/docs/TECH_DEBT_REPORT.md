# Technical Debt Report

## Executive Summary

The platform has a strong prototype core: real endpoints, a live dashboard, useful scoring terms, and a free deployment path. The main debt is architectural concentration. Too much behavior lives in large files with mixed responsibilities, which makes every future feature riskier than it needs to be.

## P0 Debt

### Provider Coupling

Hotspot: `artifacts/api-server/src/lib/finnhub.ts`

This module currently acts as provider client, websocket manager, cache, data normalizer, refresh scheduler, and market analytics source. That prevents clean support for Polygon, Tradier, Alpaca, Intrinio, options vendors, news vendors, macro feeds, or failover.

Migration:

1. Define `MarketDataProvider`.
2. Create `FinnhubMarketDataProvider`.
3. Move provider-specific DTO conversion behind adapter methods.
4. Keep existing API route response shapes stable.

### Monolithic Signal Logic

Hotspot: `artifacts/api-server/src/lib/scores.ts`

Signal factors are embedded in procedural scoring code. This makes formulas hard to test, explain, compose, or backtest. It also makes adding options flow, multi-timeframe momentum, volatility rank, and liquidity factors harder.

Migration:

1. Create one registered factor per current score component.
2. Add unit tests for each factor before changing formulas.
3. Add score composition through `SignalRegistry` and `FactorRegistry`.

### Read Endpoints With Write Side Effects

Hotspot: `artifacts/api-server/src/lib/signal-history.ts`

Live score requests can mutate signal history. This makes API behavior surprising and makes caching dangerous.

Migration:

1. Split score computation from score observation.
2. Create explicit snapshot events.
3. Persist snapshots through a history service.

## P1 Debt

### Dashboard Component Density

Hotspots:

- `artifacts/live-dashboard/src/pages/Dashboard.tsx`
- `artifacts/live-dashboard/src/components/dashboard/Watchlist.tsx`
- `artifacts/live-dashboard/src/components/dashboard/StockRow.tsx`

The frontend contains valuable market vocabulary, but the table, filters, tooltips, joins, polling, and display rules are tightly coupled. This slows design changes and makes analytics additions brittle.

Migration:

1. Extract data selectors for quotes, scores, deltas, and watchlist rows.
2. Introduce panel-level components: watchlist, scanner, signal inspector, chart, event feed.
3. Add virtualization before large universe or options-chain views.

### Empty Persistence Model

Hotspot: `lib/db/src/schema/index.ts`

The database package exists, but the schema does not yet model tickers, watchlists, signals, score snapshots, alerts, workspaces, or options data.

Migration:

1. Add instrument and watchlist tables first.
2. Add signal snapshot and factor snapshot tables.
3. Add options chain and derived exposure tables after provider contracts stabilize.

## P2 Debt

- Build settings are spread across repo config, Render config, and dashboard-specific env assumptions.
- Testing is thin for a system that will become formula-heavy.
- AI workflows are not yet represented as structured context packets.
- Error handling does not yet separate provider failure, rate limiting, stale cache, and malformed data.

## Debt Reduction Principles

- Keep public API responses stable while extracting internals.
- Write tests around formulas before changing formulas.
- Add interfaces before implementation rewrites.
- Prefer one clear adapter over broad code motion.
- Do not add options math until option chain normalization is tested.

## Phase 2 Status

The first debt reduction pass introduces API-server adapters around the current working modules. This lowers coupling in routes without changing the riskier formula and provider internals yet. The remaining debt is now more clearly staged: provider extraction, formula registry migration, explicit signal snapshot writes, and persistent storage can happen one layer at a time.
