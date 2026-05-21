import {
  getAllSignalDeltas,
  getSnapshotCount,
  setCurrentScores,
  takeSnapshotIfDue,
  type SignalDelta,
} from "../lib/signal-history";
import type { StockScore } from "../lib/scores";

export const signalHistoryService = {
  observeScores(scores: StockScore[]): void {
    setCurrentScores(scores);
    takeSnapshotIfDue(scores);
  },
  getAllSignalDeltas(): SignalDelta[] {
    return getAllSignalDeltas();
  },
  getSnapshotCount(): number {
    return getSnapshotCount();
  },
};
