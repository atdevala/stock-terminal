# Performance Report

## Executive Summary

The current app is fast enough for a small watchlist on Render Free, but its performance model will struggle with large watchlists, live screeners, options chains, and multi-panel workspaces. The primary risks are repeated recomputation, polling-heavy data flow, large React table rendering, and provider calls that are not isolated behind a streaming/event model.

## P0 Performance Risks

### Heavy Score Recalculation On Request

Hotspot: `artifacts/api-server/src/lib/scores.ts`

Score computation is useful but should not be repeatedly recomputed for the same symbol/time window when multiple clients request the same data.

Recommendations:

- Cache factor-level intermediate values with TTLs.
- Separate raw data freshness from score freshness.
- Emit score update events when dependencies change.
- Add benchmark tests for large watchlists.

### Provider Fetch And Cache Coupling

Hotspot: `artifacts/api-server/src/lib/finnhub.ts`

Provider calls, normalization, cache invalidation, refresh loops, and websocket state are coupled. This makes it hard to reason about latency and stale data.

Recommendations:

- Move cache policy to `CacheProvider`.
- Track per-provider latency, error rate, and stale reads.
- Add circuit-breaker behavior for provider throttling.

### Large UI Tables Without Virtualization

Hotspots:

- `artifacts/live-dashboard/src/components/dashboard/Watchlist.tsx`
- `artifacts/live-dashboard/src/components/dashboard/StockRow.tsx`

The current table is acceptable for a compact watchlist. It will lag with hundreds or thousands of rows, options chains, scanner results, or real-time quote bursts.

Recommendations:

- Add row virtualization for watchlists and screeners.
- Memoize row models from quote, score, and delta joins.
- Avoid recalculating tooltip content for offscreen rows.

## P1 Performance Risks

### Polling Cadence

Current dashboard queries poll quotes, scores, and deltas on independent intervals. As the platform grows, this creates redundant work and unpredictable bursts.

Recommendations:

- Keep polling for Render Free baseline.
- Add a `MarketDataBus` abstraction now.
- Later replace high-frequency polling with websocket/event updates.

### JSON Disk Cache

Hotspots:

- `artifacts/api-server/src/lib/ext-cache.ts`
- `artifacts/api-server/src/lib/signal-history.ts`

JSON disk cache is simple, but it can become a blocking bottleneck and is not durable on temporary infrastructure.

Recommendations:

- Keep JSON cache for free deployment only.
- Introduce a storage port for cache/history.
- Later move history to Postgres/Timescale and hot state to Redis.

## P2 Performance Risks

- No performance budget for dashboard render time.
- No load tests for scanner universe growth.
- No memory-leak checks for websocket subscriptions.
- No payload size limits or compression strategy documented.

## Optimization Roadmap

1. Add memoized API selectors and frontend row-model selectors.
2. Add factor-level tests and benchmarks.
3. Introduce `MarketDataBus` events while keeping existing REST endpoints.
4. Add virtualized watchlist and screener tables.
5. Add provider latency metrics and stale-cache visibility.
6. Add Redis pub/sub and TimescaleDB only when free deployment limits are outgrown.

