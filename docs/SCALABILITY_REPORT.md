# Scalability Report

## Executive Summary

The current deployment is intentionally lean: one Render Free web service, Express API, built Vite dashboard, Finnhub data, memory cache, and temporary disk cache. That is the right baseline for zero-cost hosting. It is not the final architecture for multi-user, multi-provider, real-time, options-heavy intelligence.

## P0 Scalability Constraints

### Single Provider Assumption

The platform is built around Finnhub as the implicit source of truth. Institutional-grade analytics need provider routing, capability discovery, failover, and normalization.

Target:

- `MarketDataProvider` for quotes, candles, fundamentals, news, options chains, events, and streaming.
- `ProviderRouter` to choose provider by asset class, capability, cost, latency, and health.

### Process-Local State

Signal history, live score state, refresh status, and caches are process-local or JSON-backed. This breaks under horizontal scaling and restarts.

Target:

- Redis for hot cache, pub/sub, and short-lived event fanout.
- Postgres/TimescaleDB for durable market snapshots, signal history, alerts, and workspace state.
- Object storage for large historical exports if needed.

### No Event Backbone

Without a normalized event bus, every feature must call into provider modules directly or poll REST endpoints.

Target:

- `MarketEvent` as the normalized message format.
- `MarketDataBus` for quote, candle, score, options, news, alert, and provider health events.
- Batched frontend updates to reduce render churn.

## P1 Scalability Constraints

### API Surface Growth

The current API can support watchlists and scanner endpoints, but options chains, screeners, alerts, AI summaries, backtests, and portfolios need clear module boundaries.

Target modules:

- `/data`
- `/signals`
- `/screeners`
- `/options`
- `/ai`
- `/alerts`
- `/workspaces`
- `/risk`

### Database Schema Gap

The database package is present but not yet modeling domain entities.

Recommended schema order:

1. `instruments`
2. `watchlists`
3. `watchlist_items`
4. `quotes_latest`
5. `candles`
6. `signal_snapshots`
7. `factor_snapshots`
8. `scanner_runs`
9. `alerts`
10. `workspace_layouts`
11. `options_contracts`
12. `options_chain_snapshots`
13. `dealer_exposure_snapshots`

## P2 Scalability Constraints

- No formal rate-limit budgets by provider.
- No tenant/user model yet.
- No saved screener templates.
- No persistent workspace layouts.
- No event replay or historical factor reconstruction.

## Scaling Strategy

### Free Baseline

- One Render Free web service.
- Finnhub provider.
- REST polling.
- JSON cache in `/tmp`.
- No durable history guarantees.

### Serious Single-User Upgrade

- Render paid or equivalent always-on host.
- Managed Postgres.
- Durable watchlists, signals, and workspaces.
- Provider abstraction remains in-process.

### Institutional Architecture

- API service, worker service, websocket gateway.
- Redis pub/sub and cache.
- Postgres/TimescaleDB.
- Provider workers per data vendor.
- AI worker for retrieval and summaries.
- Observability for provider health, score latency, and stale data.

