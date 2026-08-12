import "dotenv/config";
// no-op: persistent-disk cache-survival test deploy
import app from "./app";
import { logger } from "./lib/logger";
import { startFinnhubService } from "./lib/finnhub";
import { startScannerService } from "./lib/scanner";

// ── Startup environment validation ────────────────────────────────────────────
// Fail fast with a clear message rather than silently misbehaving.

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
if (!FINNHUB_KEY || FINNHUB_KEY.trim() === "") {
  console.error(
    "\n[FATAL] FINNHUB_API_KEY is not set.\n" +
    "  Get a free key at https://finnhub.io and add it to your .env file.\n" +
    "  See .env.example for all required variables.\n"
  );
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.trim() === "") {
  logger.warn(
    "ANTHROPIC_API_KEY is not set — Breakout Candidates and Options Setups will show " +
    "their ranked lists and real computed drivers, but AI write-ups will read " +
    "\"unavailable\" instead of generating. Not fatal; see .env.example.",
  );
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start Finnhub WebSocket + REST data service
  void startFinnhubService();
  // Start INS market scanner (delayed 10s, then every 15 min)
  void startScannerService();
});
