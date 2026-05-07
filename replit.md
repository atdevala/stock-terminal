# Atdevala Stock Watchlist

A personal financial dashboard tracking 30 watchlist stocks across 9 categories with live prices, 6 proprietary signal scores, and a signal movement tracker.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/live-dashboard run dev` — run the frontend (port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 22, TypeScript 5.x
- API: Express 5 (port 8080, serves at `/api`)
- Frontend: React 19 + Vite 7 + Tailwind CSS 4
- Charts: Recharts 2
- Data: Finnhub WebSocket + REST (free tier)
- Signal history: JSON file persistence (`artifacts/api-server/data/signal-history.json`)
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle for API), Vite (static for frontend)

## Where things live

| Path | Purpose |
|------|---------|
| `lib/api-spec/openapi.yaml` | Source-of-truth OpenAPI spec — edit here, then run codegen |
| `lib/api-client-react/` | Generated React Query hooks (do not edit manually) |
| `artifacts/api-server/src/lib/scores.ts` | VQS, GVS, COS, INS, ACS, FBRS score formulas |
| `artifacts/api-server/src/lib/finnhub.ts` | WebSocket + REST data engine |
| `artifacts/api-server/src/lib/signal-history.ts` | Snapshot store, delta/trend/divergence engine |
| `artifacts/api-server/src/lib/scanner.ts` | 80-stock INS scanner |
| `artifacts/api-server/src/lib/stocks-data.ts` | Watchlist tickers and categories |
| `artifacts/api-server/data/` | Persisted signal history JSON |
| `artifacts/live-dashboard/src/pages/Dashboard.tsx` | Tab navigation (Watchlist / INS Scanner / Signal Tracker) |
| `artifacts/live-dashboard/src/components/dashboard/StockRow.tsx` | Score badges with inline delta indicators |
| `artifacts/live-dashboard/src/pages/SignalTrackerPage.tsx` | Signal Movement Tracker tab |

## Signal Scores

| Score | Description |
|-------|-------------|
| **VQS** | Valuation Quality Score — fundamental strength |
| **GVS** | Growth Volatility Score — momentum & breakout potential |
| **COS** | Combined Opportunity Score — blended VQS + GVS |
| **INS** | Inflection Signal Score — leading breakout indicator (violet) |
| **ACS** | Accumulation Confidence Score — institutional buying detection (teal) |
| **FBRS** | False Breakout Risk Score — hype-driven move caution |

Score colors: ≥75 emerald, ≥55 yellow, ≥35 orange, <35 red. INS uses violet, ACS uses teal.

## Signal History / Movement Tracker

- Snapshots every 30 min (debounced), persisted to `artifacts/api-server/data/signal-history.json`
- Deltas shown inline on Watchlist score badges (1D preferred, falls back to 7D)
- Full tracker tab: trend arrows, sparklines, divergence flags, acceleration indicators
- Divergence flags: EARLY IGNITION SETUP · INSTITUTIONAL ACCUMULATION · SPECULATIVE MOMENTUM · LATE CYCLE / EXHAUSTION RISK

## Architecture decisions

- **Contract-first API**: OpenAPI spec → Orval codegen → typed hooks. Never write fetch calls manually.
- **No DB for signal history**: File-based JSON is sufficient and zero-dependency for self-hosted deployment.
- **Finnhub free tier**: `/stock/candle` returns 403, so ACS/FBRS use quote data (52W range, EPS surprises, recommendations) instead of historical candles.
- **esbuild bundle**: The API server is bundled to a single `dist/index.mjs` for fast cold starts; `DATA_DIR` env var ensures the data directory resolves correctly in both dev and prod.
- **No Replit runtime deps**: Replit Vite plugins are all guarded by `REPL_ID !== undefined` — the app runs identically on any host.

## Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FINNHUB_API_KEY` | YES | Free key from https://finnhub.io |
| `PORT` | YES | Port for each service |
| `NODE_ENV` | YES | `development` or `production` |
| `DATA_DIR` | NO | Absolute path for signal history JSON (default: `<api-server>/data`) |
| `BASE_PATH` | NO | Frontend base path, defaults to `/` |

See `.env.example` and `DEPLOY.md` for full deployment instructions.

## User preferences

- Score color thresholds: ≥75 emerald, ≥55 yellow, ≥35 orange, <35 red
- INS uses violet color scheme, ACS uses teal
- Dark mode only (forced via `document.documentElement.classList.add("dark")`)

## Gotchas

- Run codegen after every OpenAPI spec change: `pnpm --filter @workspace/api-spec run codegen`
- The API server `dev` script sets `DATA_DIR=$(pwd)/data` automatically — do not remove this
- `pnpm-workspace.yaml` `minimumReleaseAge: 1440` is a supply-chain security setting — do not disable
- Signal history delta indicators on the Watchlist are empty until the first 30-min snapshot fires

## Portability

See `DEPLOY.md` for full instructions on deploying to AWS, Render, Railway, VPS, Docker, etc.
The codebase has zero Replit runtime dependencies — it runs identically anywhere Node.js 20+ is available.
