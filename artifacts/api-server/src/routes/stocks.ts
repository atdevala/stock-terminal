import { Router } from "express";
import { CATEGORIES } from "../lib/stocks-data";
import {
  getAllQuotes,
  getAllExtendedMetrics,
  getQuote,
  getMarketStatus,
  isWsConnected,
} from "../lib/finnhub";
import { computeScore } from "../lib/scores";
import { getScannerState, triggerScan } from "../lib/scanner";

const router = Router();

router.get("/stocks", (_req, res) => {
  res.json(CATEGORIES);
});

router.get("/quotes", (_req, res) => {
  res.json({
    quotes: getAllQuotes(),
    connected: isWsConnected(),
    lastRefreshed: Date.now(),
  });
});

router.get("/market-status", (_req, res) => {
  const s = getMarketStatus();
  res.json({ isOpen: s.isOpen, exchange: s.exchange, timezone: s.timezone, session: s.session });
});

router.get("/scores", (_req, res) => {
  const metrics = getAllExtendedMetrics();
  const scores = metrics.map(ext => {
    const q = getQuote(ext.ticker);
    return computeScore(ext.ticker, ext, q?.price ?? 0, q?.changePercent ?? 0);
  });
  res.json(scores);
});

router.get("/movers", (_req, res) => {
  const quotes = getAllQuotes().filter(q => q.price > 0);
  const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
  const gainers = sorted.slice(0, 5).map(q => ({
    ticker: q.ticker, company: q.ticker, price: q.price, changePercent: q.changePercent,
  }));
  const losers = sorted.slice(-5).reverse().map(q => ({
    ticker: q.ticker, company: q.ticker, price: q.price, changePercent: q.changePercent,
  }));
  res.json({ gainers, losers });
});

router.get("/scanner", (_req, res) => {
  res.json(getScannerState());
});

router.post("/scanner/refresh", (_req, res) => {
  triggerScan();
  res.json({ message: "Scan triggered" });
});

export default router;
