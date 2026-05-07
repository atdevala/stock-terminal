import app from "./app";
import { logger } from "./lib/logger";
import { startFinnhubService } from "./lib/finnhub";
import { startScannerService } from "./lib/scanner";

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
