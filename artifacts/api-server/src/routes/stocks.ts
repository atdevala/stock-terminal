import { Router } from "express";
import { CATEGORIES } from "../lib/stocks-data";
import {
  getAllQuotes,
  getMarketStatus,
  isWsConnected,
} from "../lib/finnhub";

const router = Router();

router.get("/stocks", (_req, res) => {
  res.json(CATEGORIES);
});

router.get("/quotes", (_req, res) => {
  const quotes = getAllQuotes();
  res.json({
    quotes,
    connected: isWsConnected(),
    lastRefreshed: Date.now(),
  });
});

router.get("/market-status", (_req, res) => {
  const status = getMarketStatus();
  res.json({
    isOpen:   status.isOpen,
    exchange: status.exchange,
    timezone: status.timezone,
    session:  status.session,
  });
});

router.get("/movers", (_req, res) => {
  const quotes = getAllQuotes().filter(q => q.price > 0);
  const sorted = [...quotes].sort((a, b) => b.changePercent - a.changePercent);
  const gainers = sorted.slice(0, 5).map(q => ({
    ticker:        q.ticker,
    company:       q.ticker,
    price:         q.price,
    changePercent: q.changePercent,
  }));
  const losers = sorted.slice(-5).reverse().map(q => ({
    ticker:        q.ticker,
    company:       q.ticker,
    price:         q.price,
    changePercent: q.changePercent,
  }));
  res.json({ gainers, losers });
});

export default router;
