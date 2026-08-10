# Deployment Guide — Atdevala Stock Watchlist

This app is a pnpm monorepo with two services:

| Service | Directory | Default Port |
|---------|-----------|-------------|
| API server (Express 5) | `artifacts/api-server` | `8080` |
| Dashboard (React + Vite) | `artifacts/live-dashboard` | `3000` |

---

## Prerequisites

- **Node.js 20+** (22+ recommended)
- **pnpm 9+** — `npm install -g pnpm`
- A **Finnhub API key** — free at https://finnhub.io

---

## 1. Clone & install

```bash
git clone <your-repo>
cd <repo-root>
pnpm install
```

---

## 2. Environment setup

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```
FINNHUB_API_KEY=your_key_here
```

---

## 3. Development (two terminals)

**Terminal 1 — API server:**
```bash
cd artifacts/api-server
PORT=8080 FINNHUB_API_KEY=your_key pnpm run dev
```

**Terminal 2 — Frontend:**
```bash
cd artifacts/live-dashboard
PORT=3000 BASE_PATH=/ pnpm run dev
```

Then open `http://localhost:3000`.

> The frontend calls `/api/*` relative to its own origin. For local dev you need
> a reverse proxy (see nginx example below) OR configure a Vite proxy.

---

## 4. Production build

### Build everything
```bash
pnpm run build
```

This typechecks and builds:
- API server → `artifacts/api-server/dist/index.mjs`
- Dashboard  → `artifacts/live-dashboard/dist/public/`

### Run API server
```bash
PORT=8080 \
NODE_ENV=production \
FINNHUB_API_KEY=your_key \
DATA_DIR=/var/data/atdevala \
node --enable-source-maps artifacts/api-server/dist/index.mjs
```

### Serve frontend
Serve `artifacts/live-dashboard/dist/public` as static files from your web server.
All routes (`/*`) should rewrite to `index.html` (SPA routing).

---

## 5. Docker Compose (recommended for VPS / cloud)

```yaml
# docker-compose.yml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      NODE_ENV: production
      FINNHUB_API_KEY: "${FINNHUB_API_KEY}"
      DATA_DIR: /data
    volumes:
      - signal_data:/data
    restart: unless-stopped

  web:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./artifacts/live-dashboard/dist/public:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api
    restart: unless-stopped

volumes:
  signal_data:
```

**`Dockerfile.api`:**
```dockerfile
FROM node:22-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
```

---

## 6. Nginx config

```nginx
# nginx.conf
server {
    listen 80;

    # Route API calls to the Express server
    location /api/ {
        proxy_pass http://api:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Serve the React SPA
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 7. Platform-specific notes
### Render Free Web Service

This repository includes `render.yaml` for a free single-service deployment.
The Express API serves both `/api/*` and the built React dashboard in production.

Render settings:

- Service type: Web Service
- Runtime: Node
- Plan: Free
- Build command: `corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm install --frozen-lockfile && pnpm run build`
- Start command: `node --enable-source-maps artifacts/api-server/dist/index.mjs`

Required environment variables:

```text
FINNHUB_API_KEY=your_key_here
NODE_ENV=production
DATA_DIR=/tmp/atdevala
```

Notes:

- Render provides `PORT` automatically.
- Free services sleep after inactivity and may take about a minute to wake.
- `/tmp/atdevala` is temporary storage, so signal history may reset after restarts or redeploys.
- Health checks can use `/api/health` or `/api/healthz`.

### Railway / Render / Fly.io
- Set all env vars in the platform dashboard
- Build command: `pnpm install && pnpm run build`
- Start command: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- Set `DATA_DIR` to a persistent volume mount path
- Serve `artifacts/live-dashboard/dist/public` as a separate static site service

### AWS EC2 / VPS
Use the Docker Compose setup above, or run both services with `systemd` / `pm2`:
```bash
pm2 start "node artifacts/api-server/dist/index.mjs" --name atdevala-api \
  --env PORT=8080,NODE_ENV=production,FINNHUB_API_KEY=...,DATA_DIR=/var/data/atdevala
```

---

## 8. Portability checklist

- [x] Runs locally from a clean install (`pnpm install && pnpm run build`)
- [x] Runs without Replit — no Replit-specific runtime dependencies
- [x] No missing dependencies — all listed in `package.json` per workspace package
- [x] No hardcoded paths — `DATA_DIR` env var controls signal history location
- [x] Env vars fully externalized — see `.env.example`
- [x] Data persists across restart — JSON written to `DATA_DIR/signal-history.json`
- [x] Scheduler works independently — built-in `setInterval`/`setTimeout` loops (no Replit services)
- [x] Dashboard runs standalone — built to static files, servable by any web server
- [x] FINNHUB_API_KEY validated at startup — process exits with clear message if missing
- [x] All platforms supported — no linux-x64-only binary exclusions in `pnpm-workspace.yaml`

---

## 9. Data persistence

Signal history is stored as JSON at `DATA_DIR/signal-history.json` (default: `artifacts/api-server/data/`).

- Snapshots taken every **30 minutes** automatically
- Max **500 snapshots per ticker** (~90 days at 4× daily)
- File is read on server startup — history survives restarts
- For production, point `DATA_DIR` to a persistent volume

---

## 10. Scheduled updates

The system uses Node.js `setInterval` / `setTimeout` — no cron daemon or external scheduler required:

| Task | Interval |
|------|----------|
| Quote refresh (WebSocket) | Real-time via Finnhub WS |
| Extended metrics refresh | Every 6 hours |
| INS scanner sweep | Every 15 minutes |
| Signal history snapshot | Every 30 minutes (debounced) |

Manual refresh available via `POST /api/scanner/refresh`.
