import { Router } from "express";
import { logger } from "../lib/logger";
import { CATEGORIES } from "../lib/stocks-data";
import {
  marketDataService,
  scannerService,
  scoreService,
  signalHistoryService,
} from "../services";

const router = Router();

router.get("/stocks", (_req, res) => {
  res.json(CATEGORIES);
});

router.get("/quotes", (_req, res) => {
  res.json(marketDataService.getQuotesResponse());
});

router.get("/market-status", (_req, res) => {
  res.json(marketDataService.getMarketStatusResponse());
});

router.get("/scores", (_req, res) => {
  try {
    res.json(scoreService.computeScoresAndRecordSnapshot());
  } catch (err) {
    logger.error({ err }, "/scores route failed");
    res.status(500).json({ error: "Score computation failed" });
  }
});

router.get("/movers", (_req, res) => {
  res.json(marketDataService.getTopMovers());
});

router.get("/scanner", (_req, res) => {
  res.json(scannerService.getState());
});

router.post("/scanner/refresh", (_req, res) => {
  scannerService.triggerRefresh();
  res.json({ message: "Scan triggered" });
});

router.post("/scanner/symbol", async (req, res) => {
  try {
    const result = await scannerService.scanSymbol(req.body?.ticker);
    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        reason: result.reason,
      });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "/scanner/symbol route failed");
    res.status(500).json({ error: "Symbol scan failed", reason: "PROVIDER_ERROR" });
  }
});

router.get("/sectors", (_req, res) => {
  try {
    res.json(scoreService.computeSectorRotation());
  } catch (err) {
    logger.error({ err }, "/sectors route failed");
    res.status(500).json({ error: "Sector computation failed" });
  }
});

router.get("/market-regime", (_req, res) => {
  res.json(marketDataService.getMarketRegime());
});

router.get("/signal-deltas", (_req, res) => {
  res.json(signalHistoryService.getAllSignalDeltas());
});

export default router;
