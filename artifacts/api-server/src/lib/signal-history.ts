import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";
import type { StockScore } from "./scores";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SignalSnapshot {
  ts:   number;
  vqs:  number;
  gvs:  number;
  cos:  number;
  ins:  number;
  acs:  number;
  csos: number;
  cpe:  number;
}

export interface SignalValues {
  vqs:  number;
  gvs:  number;
  cos:  number;
  ins:  number;
  acs:  number;
  csos: number;
  cpe:  number;
}

export type SignalTrend =
  | "STRONGLY_RISING"
  | "RISING"
  | "FLAT"
  | "FALLING"
  | "STRONGLY_FALLING";

export interface SignalTrends {
  vqs:  SignalTrend;
  gvs:  SignalTrend;
  cos:  SignalTrend;
  ins:  SignalTrend;
  acs:  SignalTrend;
  csos: SignalTrend;
  cpe:  SignalTrend;
}

export interface SignalDelta {
  ticker:          string;
  current:         SignalValues;
  /** Delta vs snapshot closest to 1 hour ago (requires ≥30 min of history) */
  delta1H:         SignalValues | null;
  delta1D:         SignalValues | null;
  delta7D:         SignalValues | null;
  /** Fallback delta vs oldest available snapshot when 1D/7D not yet available */
  deltaBaseline:   SignalValues | null;
  /** Age in ms of the baseline snapshot (used to render a human-readable period label) */
  baselineAgeMs:   number | null;
  accel:           SignalValues | null;
  trends:          SignalTrends;
  divergence:      string;
  history:         { ts: number; ins: number; cos: number; acs: number }[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_SNAPSHOTS     = 500;
const MIN_INTERVAL_MS   = 30 * 60 * 1000; // 30 min minimum between snapshots
const MIN_BASELINE_MS   = 2 * 60 * 1000; // baseline must be at least 2 min old

// DATA_DIR resolution — portable across dev (tsx source) and prod (esbuild bundle):
//
//   Dev  (tsx runs src/lib/signal-history.ts):  __dirname = src/lib  → ../../data = api-server/data ✓
//   Prod (bundle at dist/index.mjs):             __dirname = dist     → ../data   = api-server/data ✓
//
// Set DATA_DIR env var to an absolute path to override in any environment.
// The api-server dev script sets DATA_DIR=$(pwd)/data automatically so both modes work.
const _thisDir = path.dirname(fileURLToPath(import.meta.url));
const _isDist  = _thisDir.endsWith("dist") || _thisDir.endsWith("dist/");
const DATA_FILE = path.resolve(
  process.env.DATA_DIR ?? path.resolve(_thisDir, _isDist ? "../data" : "../../data"),
  "signal-history.json"
);

// ── In-memory stores ───────────────────────────────────────────────────────────

const store = new Map<string, SignalSnapshot[]>();
let lastSnapshotTs = 0;

/** Live scores cache — updated by /api/scores on every request */
const _liveScores = new Map<string, StockScore>();

export function setCurrentScores(scores: StockScore[]): void {
  _liveScores.clear();
  for (const s of scores) _liveScores.set(s.ticker, s);
}

// ── Persistence ───────────────────────────────────────────────────────────────

function loadFromDisk(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw  = fs.readFileSync(DATA_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, SignalSnapshot[]>;
      for (const [ticker, snaps] of Object.entries(data)) {
        store.set(ticker, snaps);
      }
      logger.info(`Signal history loaded from disk: ${store.size} tickers`);
    }
  } catch (err) {
    logger.warn({ err }, "Could not load signal history from disk — starting fresh");
  }
}

function saveToDisk(): void {
  try {
    const data: Record<string, SignalSnapshot[]> = {};
    for (const [ticker, snaps] of store.entries()) {
      data[ticker] = snaps;
    }
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data), "utf-8");
  } catch (err) {
    logger.warn({ err }, "Could not save signal history to disk");
  }
}

// ── Snapshot capture ──────────────────────────────────────────────────────────

export function takeSnapshotIfDue(scores: StockScore[]): void {
  // Skip empty-data calls — Finnhub may not have loaded yet.
  // Critically: do NOT update lastSnapshotTs here, or the 30-min timer
  // fires prematurely and the first real snapshot is delayed by another 30 min.
  if (scores.length === 0) return;

  const now = Date.now();
  if (now - lastSnapshotTs < MIN_INTERVAL_MS) return; // debounce
  lastSnapshotTs = now;

  for (const s of scores) {
    const snap: SignalSnapshot = {
      ts:   now,
      vqs:  s.vqs,
      gvs:  s.gvs,
      cos:  s.cos,
      ins:  s.ins ?? 50,
      acs:  s.acs,
      csos: s.csos,
      cpe:  s.cpe ?? 0,
    };

    const existing = store.get(s.ticker) ?? [];
    existing.push(snap);
    if (existing.length > MAX_SNAPSHOTS) {
      existing.splice(0, existing.length - MAX_SNAPSHOTS);
    }
    store.set(s.ticker, existing);
  }

  saveToDisk();
  logger.info(`Signal snapshot captured: ${scores.length} tickers`);
}

// ── Delta helpers ─────────────────────────────────────────────────────────────

function findSnapshotNear(snaps: SignalSnapshot[], targetTs: number): SignalSnapshot | null {
  let best: SignalSnapshot | null = null;
  for (const s of snaps) {
    if (s.ts <= targetTs) {
      if (!best || s.ts > best.ts) best = s;
    }
  }
  return best;
}

/** Diff: current live values minus a historical snapshot */
function diffVals(current: SignalValues, snap: SignalSnapshot): SignalValues {
  return {
    vqs:  Math.round(current.vqs  - snap.vqs),
    gvs:  Math.round(current.gvs  - snap.gvs),
    cos:  Math.round(current.cos  - snap.cos),
    ins:  Math.round(current.ins  - snap.ins),
    acs:  Math.round(current.acs  - snap.acs),
    // Use null-guard (not ?? 0) so that snapshots saved before these fields
    // existed produce a 0 delta rather than the full current score.
    csos: snap.csos != null ? Math.round(current.csos - snap.csos) : 0,
    cpe:  snap.cpe  != null ? Math.round(current.cpe  - snap.cpe)  : 0,
  };
}

/** Diff: snapshot A minus snapshot B */
function diffSnaps(a: SignalSnapshot, b: SignalSnapshot): SignalValues {
  return {
    vqs:  Math.round(a.vqs  - b.vqs),
    gvs:  Math.round(a.gvs  - b.gvs),
    cos:  Math.round(a.cos  - b.cos),
    ins:  Math.round(a.ins  - b.ins),
    acs:  Math.round(a.acs  - b.acs),
    csos: (a.csos != null && b.csos != null) ? Math.round(a.csos - b.csos) : 0,
    cpe:  (a.cpe  != null && b.cpe  != null) ? Math.round(a.cpe  - b.cpe)  : 0,
  };
}

function classifyTrend(delta: number): SignalTrend {
  if (delta >= 6)  return "STRONGLY_RISING";
  if (delta >= 2)  return "RISING";
  if (delta <= -6) return "STRONGLY_FALLING";
  if (delta <= -2) return "FALLING";
  return "FLAT";
}

function computeTrends(delta: SignalValues | null): SignalTrends {
  const d = delta ?? { vqs: 0, gvs: 0, cos: 0, ins: 0, acs: 0, csos: 0, cpe: 0 };
  return {
    vqs:  classifyTrend(d.vqs),
    gvs:  classifyTrend(d.gvs),
    cos:  classifyTrend(d.cos),
    ins:  classifyTrend(d.ins),
    acs:  classifyTrend(d.acs),
    csos: classifyTrend(d.csos),
    cpe:  classifyTrend(d.cpe),
  };
}

function detectDivergence(
  current: SignalValues,
  trends:  SignalTrends,
): string {
  const rising  = (t: SignalTrend) => t === "RISING" || t === "STRONGLY_RISING";
  const falling = (t: SignalTrend) => t === "FALLING" || t === "STRONGLY_FALLING";

  if (rising(trends.ins) && rising(trends.acs) && current.cos < 65) {
    return "EARLY IGNITION SETUP";
  }
  if (rising(trends.ins) && falling(trends.cos)) {
    return "SPECULATIVE MOMENTUM (UNCONFIRMED)";
  }
  if (rising(trends.cos) && falling(trends.ins)) {
    return "LATE CYCLE / EXHAUSTION RISK";
  }
  if (rising(trends.acs) && rising(trends.ins) && trends.cos === "FLAT") {
    return "INSTITUTIONAL ACCUMULATION BEFORE REPRICING";
  }
  return "";
}

// ── Public query API ──────────────────────────────────────────────────────────

export function getAllSignalDeltas(): SignalDelta[] {
  const now     = Date.now();
  const results: SignalDelta[] = [];

  // Build the full set of tickers from both live scores and history store
  const allTickers = new Set([..._liveScores.keys(), ...store.keys()]);

  for (const ticker of allTickers) {
    const snaps    = store.get(ticker) ?? [];
    const liveSc   = _liveScores.get(ticker);
    const latestSn = snaps.length > 0 ? snaps[snaps.length - 1] : null;

    if (!liveSc && !latestSn) continue;

    // "Current" values: prefer live score (real-time), fall back to latest snapshot
    const current: SignalValues = liveSc
      ? { vqs: liveSc.vqs, gvs: liveSc.gvs, cos: liveSc.cos, ins: liveSc.ins ?? 50, acs: liveSc.acs, csos: liveSc.csos, cpe: liveSc.cpe ?? 0 }
      : { vqs: latestSn!.vqs, gvs: latestSn!.gvs, cos: latestSn!.cos, ins: latestSn!.ins, acs: latestSn!.acs, csos: latestSn!.csos ?? 0, cpe: latestSn!.cpe ?? 0 };

    // 1H / 1D / 7D deltas: compare current to snapshots at each horizon
    const snap1H  = findSnapshotNear(snaps, now - 1  * 3600_000);
    const snap1D  = findSnapshotNear(snaps, now - 24 * 3600_000);
    const snap7D  = findSnapshotNear(snaps, now - 7  * 86400_000);
    const snap48h = findSnapshotNear(snaps, now - 48 * 3600_000);

    // Only count snap1H if it's actually ≥30 min old (avoids duplicate with baseline)
    const delta1H = (snap1H && now - snap1H.ts >= 30 * 60_000) ? diffVals(current, snap1H) : null;
    const delta1D = snap1D ? diffVals(current, snap1D) : null;
    const delta7D = snap7D ? diffVals(current, snap7D) : null;

    // Acceleration: how much faster 1D changed vs the prior 1D window
    let accel: SignalValues | null = null;
    if (delta1D && snap1D && snap48h) {
      const prev1D = diffSnaps(snap1D, snap48h);
      accel = {
        vqs:  delta1D.vqs  - prev1D.vqs,
        gvs:  delta1D.gvs  - prev1D.gvs,
        cos:  delta1D.cos  - prev1D.cos,
        ins:  delta1D.ins  - prev1D.ins,
        acs:  delta1D.acs  - prev1D.acs,
        csos: delta1D.csos - prev1D.csos,
        cpe:  delta1D.cpe  - prev1D.cpe,
      };
    }

    // Baseline delta: shown when 1D/7D snapshots don't exist yet.
    // Uses the oldest snapshot that is at least MIN_BASELINE_MS old.
    // This lets the user see *some* delta immediately after the first snapshot cycle.
    let deltaBaseline: SignalValues | null = null;
    let baselineAgeMs: number | null = null;

    if (!delta1D && !delta7D && snaps.length > 0) {
      const oldest = snaps[0];
      const age    = now - oldest.ts;
      if (age >= MIN_BASELINE_MS) {
        deltaBaseline = diffVals(current, oldest);
        baselineAgeMs = age;
      }
    }

    const bestDeltaForTrend = delta1D ?? deltaBaseline;
    const trends     = computeTrends(bestDeltaForTrend);
    const divergence = detectDivergence(current, trends);

    // Last 30 snapshots for sparklines
    const history = snaps.slice(-30).map(s => ({
      ts:  s.ts,
      ins: s.ins,
      cos: s.cos,
      acs: s.acs,
    }));

    results.push({
      ticker,
      current,
      delta1H,
      delta1D,
      delta7D,
      deltaBaseline,
      baselineAgeMs,
      accel,
      trends,
      divergence,
      history,
    });
  }

  results.sort((a, b) => b.current.ins - a.current.ins);
  return results;
}

export function getSnapshotCount(): number {
  let total = 0;
  for (const snaps of store.values()) total += snaps.length;
  return total;
}

// Load history from disk when module is first imported
loadFromDisk();
