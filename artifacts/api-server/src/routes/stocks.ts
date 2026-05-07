import { Router } from "express";
import { CATEGORIES } from "../lib/stocks-data";
import {
  getAllQuotes,
  getAllExtendedMetrics,
  getQuote,
  getMarketStatus,
  isWsConnected,
  getMarketRegime,
} from "../lib/finnhub";
import { computeScore, mean } from "../lib/scores";
import { getScannerState, triggerScan } from "../lib/scanner";
import { takeSnapshotIfDue, getAllSignalDeltas } from "../lib/signal-history";

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
    return computeScore(ext.ticker, ext, q?.price ?? 0, q?.changePercent ?? 0, q);
  });
  // Take a snapshot of current scores for the signal history tracker (debounced to 30 min)
  takeSnapshotIfDue(scores);
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

// ── Sector Rotation Engine ─────────────────────────────────────────────────────

router.get("/sectors", (_req, res) => {
  const metrics = getAllExtendedMetrics();
  const qMap    = new Map(getAllQuotes().map(q => [q.ticker, q]));

  type CatEntry = { name: string; color: string; ins: number[]; cos: number[]; acs: number[] };
  const catMap  = new Map<string, CatEntry>();
  for (const cat of CATEGORIES) {
    catMap.set(cat.name, { name: cat.name, color: cat.color, ins: [], cos: [], acs: [] });
  }

  for (const ext of metrics) {
    const q = qMap.get(ext.ticker);
    if (!q || q.price === 0) continue;
    const scored = computeScore(ext.ticker, ext, q.price, q.changePercent, q);
    const cat    = CATEGORIES.find(c => c.stocks.some(s => s.ticker === ext.ticker));
    if (!cat) continue;
    const entry  = catMap.get(cat.name)!;
    entry.ins.push(scored.ins ?? 0);
    entry.cos.push(scored.cos);
    entry.acs.push(scored.acs);
  }

  const sectors = [...catMap.values()]
    .filter(c => c.ins.length > 0)
    .map(c => ({
      name:       c.name,
      color:      c.color,
      avgIns:     Math.round(mean(c.ins)),
      avgCos:     Math.round(mean(c.cos)),
      avgAcs:     Math.round(mean(c.acs)),
      stockCount: c.ins.length,
      hotRank:    0,
    }))
    .sort((a, b) => b.avgIns - a.avgIns)
    .map((s, i) => ({ ...s, hotRank: i + 1 }));

  res.json(sectors);
});

// ── Market Regime Detection ────────────────────────────────────────────────────

router.get("/market-regime", (_req, res) => {
  res.json(getMarketRegime());
});

// ── Signal Movement Tracker ────────────────────────────────────────────────────
// Returns per-ticker signal deltas, trend classifications, divergence flags,
// and sparkline history points. Populated from the rolling snapshot store.

router.get("/signal-deltas", (_req, res) => {
  res.json(getAllSignalDeltas());
});

export default router;
