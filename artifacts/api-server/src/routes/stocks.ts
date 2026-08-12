import { Router } from "express";
import { logger } from "../lib/logger";
import { CATEGORIES } from "../lib/stocks-data";
import { getCatalystCalendar } from "../lib/catalysts";
import { rankBreakoutCandidates, rankOptionsCandidates } from "../lib/breakout";
import {
  aiWriteupService,
  macdService,
  marketDataService,
  scannerService,
  scoreService,
  signalHistoryService,
} from "../services";

const router = Router();

router.get("/stocks", (_req, res) => {
  res.json(CATEGORIES);
});

router.get("/stocks/:ticker/macd", async (req, res) => {
  try {
    const result = await macdService.getMacd(req.params.ticker);
    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        reason: result.reason,
      });
      return;
    }

    res.json({
      ticker: result.ticker,
      range: result.range,
      points: result.points,
      cached: result.cached,
      updatedAt: result.updatedAt,
    });
  } catch (err) {
    logger.error({ err }, "/stocks/:ticker/macd route failed");
    res.status(502).json({ error: "MACD chart failed", reason: "PROVIDER_ERROR" });
  }
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

router.get("/breakout-candidates", (_req, res) => {
  try {
    const scores = scoreService.computeScores();
    const scoresByTicker = new Map(scores.map(s => [s.ticker, s]));
    const quotesMap = new Map(marketDataService.getAllQuotes().map(q => [q.ticker, q]));
    const candidates = rankBreakoutCandidates(scores, 10);

    res.json(candidates.map(c => {
      const q = quotesMap.get(c.ticker);
      const s = scoresByTicker.get(c.ticker);
      const writeup = aiWriteupService.getBreakoutWriteup(c.ticker, {
        breakoutReadiness: c.breakoutReadiness,
        ins: c.drivers.ins,
        acs: c.drivers.acs,
        vqs: c.drivers.vqs,
        lqs: c.drivers.lqs,
        rsi: c.drivers.rsi,
        fbrs: c.drivers.fbrs,
        reasonLabel: c.reasonLabel,
        price: q?.price,
        high52: s?.high52,
        low52: s?.low52,
        ma50: s?.ma50,
        ma200: s?.ma200,
      });
      return {
        ticker: c.ticker,
        company: c.company,
        price: q?.price ?? 0,
        changePercent: q?.changePercent ?? 0,
        breakoutReadiness: c.breakoutReadiness,
        reasonLabel: c.reasonLabel,
        drivers: c.drivers,
        writeup,
      };
    }));
  } catch (err) {
    logger.error({ err }, "/breakout-candidates route failed");
    res.status(500).json({ error: "Breakout candidate ranking failed" });
  }
});

router.get("/options-watch", async (_req, res) => {
  try {
    const scores = scoreService.computeScores();
    const scoresByTicker = new Map(scores.map(s => [s.ticker, s]));
    const extByTicker = new Map(marketDataService.getAllExtendedMetrics().map(e => [e.ticker, e]));
    const quotesMap = new Map(marketDataService.getAllQuotes().map(q => [q.ticker, q]));
    const candidates = await rankOptionsCandidates(scores, extByTicker, 5);

    res.json(candidates.map(c => {
      const q = quotesMap.get(c.ticker);
      const s = scoresByTicker.get(c.ticker);
      const writeup = aiWriteupService.getOptionsWriteup(c.ticker, {
        direction: c.direction,
        optionsSetupScore: c.optionsSetupScore,
        realizedVolatility20d: c.realizedVolatility20d,
        rsi: c.drivers.rsi,
        acs: c.drivers.acs,
        nextEarnings: c.nextEarnings,
        price: q?.price,
        high52: s?.high52,
        low52: s?.low52,
        ma50: s?.ma50,
        ma200: s?.ma200,
      });
      return {
        ticker: c.ticker,
        company: c.company,
        price: q?.price ?? 0,
        changePercent: q?.changePercent ?? 0,
        direction: c.direction,
        optionsSetupScore: c.optionsSetupScore,
        realizedVolatility20d: c.realizedVolatility20d,
        nextEarnings: c.nextEarnings,
        closes60d: c.closes60d,
        drivers: c.drivers,
        writeup,
      };
    }));
  } catch (err) {
    logger.error({ err }, "/options-watch route failed");
    res.status(500).json({ error: "Options candidate ranking failed" });
  }
});

// TEMPORARY — sector-blindness fix step 1 diagnostic. Confirms Finnhub's
// finnhubIndustry field is actually populating ExtendedMetrics.industry
// before any scoring math is built on top of it. Remove once verified.
router.get("/debug/industries", (_req, res) => {
  const metrics = marketDataService.getAllExtendedMetrics();
  const withIndustry = metrics.filter(m => m.industry && m.industry.trim() !== "");
  const withoutIndustry = metrics.filter(m => !m.industry || m.industry.trim() === "");

  const counts = new Map<string, number>();
  for (const m of withIndustry) {
    const key = m.industry!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const breakdown = Object.fromEntries(
    [...counts.entries()].sort((a, b) => b[1] - a[1]),
  );

  res.json({
    totalTickers: metrics.length,
    withIndustry: withIndustry.length,
    withoutIndustry: withoutIndustry.length,
    distinctIndustries: counts.size,
    breakdown,
    examples: withIndustry.slice(0, 20).map(m => ({ ticker: m.ticker, industry: m.industry })),
    missingExamples: withoutIndustry.slice(0, 10).map(m => m.ticker),
  });
});

router.get("/catalysts", async (req, res) => {
  try {
    const daysAhead = Number(req.query["days"]) || 10;
    res.json(await getCatalystCalendar(daysAhead));
  } catch (err) {
    logger.error({ err }, "/catalysts route failed");
    res.status(502).json({ error: "Catalyst calendar failed", reason: "PROVIDER_ERROR" });
  }
});

export default router;
