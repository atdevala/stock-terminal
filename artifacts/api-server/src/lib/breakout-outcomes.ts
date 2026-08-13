import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";
import { computeScore, type StockScore } from "./scores";
import { getAllExtendedMetrics, getQuote } from "./finnhub";
import { buildPeerGroupPercentiles } from "./sector";
import { rankBreakoutCandidates } from "./breakout";

// ── Outcome tracker: does the scoring actually predict anything? ──────────────
// The first feature in this project that measures whether a high signalScore
// actually preceded a real subsequent return, instead of just reasoning about
// whether it should. Logs each NEW appearance in Top Breakout Candidates
// exactly once — not once per day it happens to stay on the list — then
// checks back at 1/3/5/10 calendar days later using the same live quotes
// this project already keeps warm continuously. No new data source, no new
// API calls: this cycle only re-reads in-memory state already fetched by
// finnhub.ts's own quote refresh.
//
// Runs as its own independent background loop (startBreakoutOutcomeTracker,
// wired in from index.ts) — the same pattern lib/scanner.ts already uses,
// deliberately NOT hooked into a route handler. A multi-day checkpoint is
// exactly the kind of thing that must not silently stop just because nobody
// has the dashboard open for a few days.
//
// "Day" here means calendar days (24h/72h/120h/240h elapsed from the log
// timestamp), not trading days — simpler, always well-defined across
// weekends, and matches "1/3/5/10 days after the original log timestamp"
// literally. The 10-minute check cycle means checkpoints fire within
// minutes of becoming due, not once a day, so this granularity is more
// than precise enough in practice.

export interface BreakoutOutcomeCheckpoint {
  price: number;
  returnPct: number;
  checkedAt: number;
}

export interface BreakoutOutcomeCheckpoints {
  d1: BreakoutOutcomeCheckpoint | null;
  d3: BreakoutOutcomeCheckpoint | null;
  d5: BreakoutOutcomeCheckpoint | null;
  d10: BreakoutOutcomeCheckpoint | null;
}

export interface BreakoutOutcomeEntry {
  id: string;
  ticker: string;
  company: string;
  loggedAt: number;
  loggedDate: string; // YYYY-MM-DD, UTC
  priceAtLog: number;
  signalScoreAtLog: number;
  signalLabelAtLog: string;
  checkpoints: BreakoutOutcomeCheckpoints;
  /** True once the d10 checkpoint is filled — no further updates needed. */
  complete: boolean;
  /** False once the ticker drops off Top Breakout Candidates, so a later reappearance starts a new entry instead of being treated as the same one continuing. */
  stillActive: boolean;
}

const CHECKPOINT_DAYS = { d1: 1, d3: 3, d5: 5, d10: 10 } as const;
type CheckpointKey = keyof typeof CHECKPOINT_DAYS;

// Same DATA_DIR resolution as ext-cache.ts/consistency-check.ts — the
// persistent Disk mount on Render, overridable via DATA_DIR for local dev.
const DATA_DIR = process.env.DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const DATA_FILE = path.join(DATA_DIR, "breakout-outcomes.json");

let entries: BreakoutOutcomeEntry[] = [];

function loadFromDisk(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      entries = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as BreakoutOutcomeEntry[];
      logger.info(`Breakout outcomes loaded from disk: ${entries.length} entries`);
    }
  } catch (err) {
    logger.warn({ err }, "Could not load breakout outcomes from disk — starting fresh");
  }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(entries), "utf-8");
    } catch (err) {
      logger.warn({ err }, "Could not save breakout outcomes to disk");
    }
  }, 2_000);
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Core cycle: log new appearances + fill due checkpoints ───────────────────
// Recomputes StockScore directly (mirrors score-service.ts's own two-pass
// peer-percentile computation) rather than importing score-service.ts —
// this keeps breakout-outcomes.ts a lib-only module with no dependency on
// the services/ layer, the same boundary lib/scanner.ts already keeps by
// calling computeScore() directly instead of going through score-service.

function runOutcomeCycle(): void {
  const allExt = getAllExtendedMetrics();
  if (allExt.length === 0) return; // Finnhub data not warm yet

  const percentileMap = buildPeerGroupPercentiles(allExt);
  const scores: StockScore[] = allExt.map(ext => {
    const q = getQuote(ext.ticker);
    const peerPercentile = percentileMap.get(ext.ticker) ?? null;
    return computeScore(ext.ticker, ext, q?.price ?? 0, q?.changePercent ?? 0, q, peerPercentile);
  });

  const candidates = rankBreakoutCandidates(scores, 10);
  const currentTickers = new Set(candidates.map(c => c.ticker));
  const now = Date.now();
  let changed = false;

  // 1. Mark drop-offs first — any currently-active entry whose ticker is no
  // longer on the list stops being "active," so a later reappearance is
  // correctly logged as a new, separate entry rather than being conflated
  // with the old one.
  for (const entry of entries) {
    if (entry.stillActive && !currentTickers.has(entry.ticker)) {
      entry.stillActive = false;
      changed = true;
    }
  }

  // 2. Log new appearances — a candidate ticker with no currently-active
  // entry. A ticker that's been on the list for 5 straight days only ever
  // passes this check once, on day 1; days 2-5 find an active entry already
  // and skip.
  const activeTickers = new Set(entries.filter(e => e.stillActive).map(e => e.ticker));
  for (const c of candidates) {
    if (activeTickers.has(c.ticker)) continue;
    const quote = getQuote(c.ticker);
    if (!quote || quote.price <= 0) continue; // don't log without a real price
    entries.push({
      id: `${c.ticker}-${now}`,
      ticker: c.ticker,
      company: c.company,
      loggedAt: now,
      loggedDate: todayISODate(),
      priceAtLog: quote.price,
      signalScoreAtLog: c.breakoutReadiness,
      signalLabelAtLog: c.reasonLabel,
      checkpoints: { d1: null, d3: null, d5: null, d10: null },
      complete: false,
      stillActive: true,
    });
    changed = true;
  }

  // 3. Fill any due checkpoints for entries not yet complete — independent
  // of whether the ticker is still on the list; a pick that dropped off is
  // still tracked through its full 10-day window.
  for (const entry of entries) {
    if (entry.complete) continue;
    const quote = getQuote(entry.ticker);
    if (!quote || quote.price <= 0) continue;
    for (const key of Object.keys(CHECKPOINT_DAYS) as CheckpointKey[]) {
      if (entry.checkpoints[key] !== null) continue;
      const dueAt = entry.loggedAt + CHECKPOINT_DAYS[key] * 86_400_000;
      if (now >= dueAt) {
        entry.checkpoints[key] = {
          price: quote.price,
          returnPct: Math.round(((quote.price - entry.priceAtLog) / entry.priceAtLog) * 1000) / 10,
          checkedAt: now,
        };
        changed = true;
      }
    }
    if (entry.checkpoints.d10 !== null) {
      entry.complete = true;
      changed = true;
    }
  }

  if (changed) scheduleSave();
}

export function getAllBreakoutOutcomes(): BreakoutOutcomeEntry[] {
  return [...entries].sort((a, b) => b.loggedAt - a.loggedAt);
}

// ── Background loop ────────────────────────────────────────────────────────
// Independent of any route/frontend traffic — same pattern as
// lib/scanner.ts's startScannerService(). 10-minute cadence: frequent
// enough that a checkpoint fires within ~10 min of becoming due, infrequent
// enough to be negligible overhead (zero new network calls — this only
// re-reads already-live in-memory quotes and re-runs the same scoring math
// /api/scores already does on every request).

const CYCLE_INTERVAL_MS = 10 * 60 * 1000;

export function startBreakoutOutcomeTracker(): void {
  loadFromDisk();
  runOutcomeCycle();
  setInterval(runOutcomeCycle, CYCLE_INTERVAL_MS);
}
