import { CATEGORIES } from "../lib/stocks-data";
import { computeScore, mean, type StockScore } from "../lib/scores";
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
  return marketDataService.getAllExtendedMetrics().map(ext => {
    const q = marketDataService.getQuote(ext.ticker);
    return computeScore(ext.ticker, ext, q?.price ?? 0, q?.changePercent ?? 0, q);
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
