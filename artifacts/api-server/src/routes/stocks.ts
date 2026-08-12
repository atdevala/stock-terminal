import { Router } from "express";
import { logger } from "../lib/logger";
import { CATEGORIES } from "../lib/stocks-data";
import { getCatalystCalendar } from "../lib/catalysts";
import { rankBreakoutCandidates, rankOptionsCandidates } from "../lib/breakout";
import { buildPeerGroupPercentiles, resolvePeerGroup } from "../lib/sector";
import { checkSignalConsistency } from "../lib/consistency-check";
import { getFundamentalsCacheDebugInfo } from "../lib/ext-cache";
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
    const candidates = await rankOptionsCandidates(scores, extByTicker, quotesMap, 5);

    // Phase 3 safety net (signal-consistency): breakout candidates are cheap
    // to re-derive synchronously here — no extra network call — giving this
    // request both lists needed to check for a stock landing in
    // contradictory places (e.g. a Put Candidate that's also a top breakout
    // pick). Logs findings; never blocks the response.
    checkSignalConsistency(scores, rankBreakoutCandidates(scores, 10), candidates);

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

  const tickersByIndustry = new Map<string, string[]>();
  for (const m of withIndustry) {
    const key = m.industry!;
    if (!tickersByIndustry.has(key)) tickersByIndustry.set(key, []);
    tickersByIndustry.get(key)!.push(m.ticker);
  }
  const sortedEntries = [...tickersByIndustry.entries()].sort((a, b) => b[1].length - a[1].length);
  const breakdown = Object.fromEntries(sortedEntries.map(([k, v]) => [k, v.length]));
  const byIndustry = Object.fromEntries(sortedEntries);

  res.json({
    totalTickers: metrics.length,
    withIndustry: withIndustry.length,
    withoutIndustry: withoutIndustry.length,
    distinctIndustries: tickersByIndustry.size,
    byIndustry,
    breakdown,
    examples: withIndustry.slice(0, 20).map(m => ({ ticker: m.ticker, industry: m.industry })),
    missingExamples: withoutIndustry.slice(0, 10).map(m => m.ticker),
  });
});

// TEMPORARY — sector-blindness fix step 2 diagnostic. Shows the OLD absolute-
// threshold valuationScore next to the NEW peer-group-percentile one, per
// ticker, using the real live percentile map (same buildPeerGroupPercentiles
// call score-service.ts uses) — so the before/after can be verified against
// real production data instead of a hand-worked example. Remove once verified.
router.get("/debug/valuation", (_req, res) => {
  const metrics = marketDataService.getAllExtendedMetrics();
  const percentileMap = buildPeerGroupPercentiles(metrics);

  // Mirrors the exact absolute-threshold formula in scores.ts's VALUATION
  // QUALITY SCORE block — duplicated here only so this throwaway route can
  // show both numbers side-by-side without changing computeScore's public
  // return shape. Not the source of truth; scores.ts is.
  function oldValuationScore(pe: number | undefined, evSales: number | undefined, rg: number): number {
    if (pe && pe > 0) {
      const rawPeScore = Math.max(0, Math.min(200 / pe, 20));
      let pegAdjustment = 0;
      if (rg > 0) {
        const peg = pe / Math.max(rg, 1);
        pegAdjustment = Math.max(0, Math.min(20 / peg, 20));
      }
      return Math.max(0, Math.min(rawPeScore + pegAdjustment, 40));
    } else if (evSales && evSales > 0) {
      return Math.max(0, Math.min(50 / evSales, 20));
    }
    return 0;
  }

  const rows = metrics.map(ext => {
    const pct = percentileMap.get(ext.ticker) ?? null;
    const rg = ext.revenueGrowthYoy ?? 0;
    const oldScore = oldValuationScore(ext.pe, ext.evSales, rg);
    const newScore = pct ? (pct.percentile / 100) * 40 : oldScore;
    return {
      ticker: ext.ticker,
      pe: ext.pe ?? null,
      revenueGrowthYoy: ext.revenueGrowthYoy ?? null,
      finnhubIndustry: ext.industry ?? null,
      resolvedPeerGroup: pct?.peerGroup ?? resolvePeerGroup(ext.ticker, ext.industry),
      peerGroupSize: pct?.peerGroupSize ?? null,
      percentile: pct ? Math.round(pct.percentile * 10) / 10 : null,
      usedPercentile: pct !== null,
      oldValuationScore: Math.round(oldScore * 10) / 10,
      newValuationScore: Math.round(newScore * 10) / 10,
    };
  });

  const sampleTickers = ["COHR", "NVDA", "AMD", "TSM", "IONQ", "MARA", "NNE", "MSFT"];
  const samples = sampleTickers
    .map(t => rows.find(r => r.ticker === t))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);

  res.json({ samples, allRows: rows });
});

// TEMPORARY — diagnostic for the high52/low52-empty-everywhere bug. Dumps the
// raw disk-cached fundamentals entry (with age) for a few tickers to confirm
// whether a stale/incomplete cache entry is the cause. Remove once fixed.
router.get("/debug/fundamentals-cache", (_req, res) => {
  const testTickers = ["AAOI", "IONQ", "NVDA", "AAPL", "NBIS"];
  const results = Object.fromEntries(
    testTickers.map(t => [t, getFundamentalsCacheDebugInfo(t)])
  );
  res.json(results);
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
