import { CATEGORIES } from "../lib/stocks-data";
import { computeScore, mean, type StockScore } from "../lib/scores";
import { buildPeerGroupPercentiles } from "../lib/sector";
import { marketDataService } from "./market-data-service";
import { signalHistoryService } from "./signal-history-service";
import { publishLegacyScoreEvents } from "./signal-engine-service";
import { toSignalOutput } from "./normalizers";

export interface SectorRotationRow {
  name: string;
  color: string;
  avgIns: number;
  avgCos: number;
  avgAcs: number;
  stockCount: number;
  hotRank: number;
}

function computeScores(): StockScore[] {
  // Two-pass structure (sector-blindness fix, step 2): peer-group PE
  // percentiles are a cross-ticker comparison, so they must be computed ONCE
  // across the whole universe (pass 1) before any individual computeScore()
  // call (pass 2) — a single ticker can't know its own percentile in
  // isolation. See sector.ts for the grouping/percentile logic itself.
  const allExt = marketDataService.getAllExtendedMetrics();
  const percentileMap = buildPeerGroupPercentiles(allExt);

  return allExt.map(ext => {
    const q = marketDataService.getQuote(ext.ticker);
    const peerPercentile = percentileMap.get(ext.ticker) ?? null;
    return computeScore(ext.ticker, ext, q?.price ?? 0, q?.changePercent ?? 0, q, peerPercentile);
  });
}

export const scoreService = {
  computeScores(): StockScore[] {
    return computeScores();
  },
  computeScoresAndRecordSnapshot(): StockScore[] {
    const scores = computeScores();
    signalHistoryService.observeScores(scores);
    void publishLegacyScoreEvents(scores);
    return scores;
  },
  computeSectorRotation(): SectorRotationRow[] {
    const metrics = marketDataService.getAllExtendedMetrics();
    const qMap = new Map(marketDataService.getAllQuotes().map(q => [q.ticker, q]));

    type CatEntry = { name: string; color: string; ins: number[]; cos: number[]; acs: number[] };
    const catMap = new Map<string, CatEntry>();
    for (const cat of CATEGORIES) {
      catMap.set(cat.name, { name: cat.name, color: cat.color, ins: [], cos: [], acs: [] });
    }

    for (const ext of metrics) {
      const q = qMap.get(ext.ticker);
      if (!q || q.price === 0) continue;
      const scored = computeScore(ext.ticker, ext, q.price, q.changePercent, q);
      const cat = CATEGORIES.find(c => c.stocks.some(s => s.ticker === ext.ticker));
      if (!cat) continue;
      const entry = catMap.get(cat.name)!;
      entry.ins.push(scored.ins ?? 0);
      entry.cos.push(scored.cos);
      entry.acs.push(scored.acs);
    }

    return [...catMap.values()]
      .filter(c => c.ins.length > 0)
      .map(c => ({
        name: c.name,
        color: c.color,
        avgIns: Math.round(mean(c.ins)),
        avgCos: Math.round(mean(c.cos)),
        avgAcs: Math.round(mean(c.acs)),
        stockCount: c.ins.length,
        hotRank: 0,
      }))
      .sort((a, b) => b.avgIns - a.avgIns)
      .map((s, i) => ({ ...s, hotRank: i + 1 }));
  },
  toSignalOutput,
};
