import { useMemo, useState } from "react";
import {
  useGetBreakoutOutcomes,
  getGetBreakoutOutcomesQueryKey,
  type BreakoutOutcomeEntry,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";

// ── Outcome tracker results panel ─────────────────────────────────────────────
// The first feature in this project that shows whether the scoring actually
// predicted anything, not just whether it should have. Every logged pick is
// shown — winners and losers in the same table, sorted most-recent first by
// default — because a curated "hits" list would defeat the entire point of
// an honest track record. Data itself is logged/checked by an independent
// background loop (see api-server/src/lib/breakout-outcomes.ts); this panel
// only ever reads and displays what's already persisted.

const LOW_SAMPLE_THRESHOLD = 30;
const CHECKPOINT_KEYS = ["d1", "d3", "d5", "d10"] as const;
type CheckpointKey = (typeof CHECKPOINT_KEYS)[number];
const CHECKPOINT_LABELS: Record<CheckpointKey, string> = { d1: "1D", d3: "3D", d5: "5D", d10: "10D" };

type SortKey = "recent" | "return";

/** Most recently-filled checkpoint for a pick — the fairest single "how's it doing" number across picks at different stages of completion. */
function latestAvailable(entry: BreakoutOutcomeEntry): { key: CheckpointKey; returnPct: number } | null {
  for (const key of [...CHECKPOINT_KEYS].reverse()) {
    const cp = entry.checkpoints[key];
    if (cp) return { key, returnPct: cp.returnPct };
  }
  return null;
}

function returnColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-zinc-600";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

function CheckpointCell({ entry, checkpointKey }: { entry: BreakoutOutcomeEntry; checkpointKey: CheckpointKey }) {
  const cp = entry.checkpoints[checkpointKey];
  if (!cp) return <span className="text-zinc-700 italic">pending</span>;
  return <span className={cn("font-mono", returnColor(cp.returnPct))}>{formatPercent(cp.returnPct)}</span>;
}

interface SummaryStats {
  total: number;
  perCheckpoint: Record<CheckpointKey, { count: number; pctPositive: number | null; avgReturn: number | null }>;
  best: { entry: BreakoutOutcomeEntry; returnPct: number } | null;
  worst: { entry: BreakoutOutcomeEntry; returnPct: number } | null;
}

function computeSummary(entries: BreakoutOutcomeEntry[]): SummaryStats {
  const perCheckpoint = {} as SummaryStats["perCheckpoint"];
  for (const key of CHECKPOINT_KEYS) {
    const filled = entries.map(e => e.checkpoints[key]).filter((c): c is NonNullable<typeof c> => c !== null);
    perCheckpoint[key] = {
      count: filled.length,
      pctPositive: filled.length ? Math.round((filled.filter(c => c.returnPct >= 0).length / filled.length) * 1000) / 10 : null,
      avgReturn: filled.length ? Math.round((filled.reduce((s, c) => s + c.returnPct, 0) / filled.length) * 100) / 100 : null,
    };
  }

  let best: SummaryStats["best"] = null;
  let worst: SummaryStats["worst"] = null;
  for (const entry of entries) {
    const latest = latestAvailable(entry);
    if (!latest) continue;
    if (!best || latest.returnPct > best.returnPct) best = { entry, returnPct: latest.returnPct };
    if (!worst || latest.returnPct < worst.returnPct) worst = { entry, returnPct: latest.returnPct };
  }

  return { total: entries.length, perCheckpoint, best, worst };
}

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[84px]">
      <div className="text-[9px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="text-sm font-bold text-zinc-100 tabular-nums">{value}</div>
      {sub && <div className="text-[9px] text-zinc-600">{sub}</div>}
    </div>
  );
}

function SummaryRow({ stats }: { stats: SummaryStats }) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
      <StatBlock label="Picks Tracked" value={String(stats.total)} />
      {CHECKPOINT_KEYS.map(key => {
        const s = stats.perCheckpoint[key];
        return (
          <StatBlock
            key={key}
            label={`${CHECKPOINT_LABELS[key]} Win Rate`}
            value={s.pctPositive === null ? "—" : `${s.pctPositive}%`}
            sub={s.avgReturn === null ? undefined : `avg ${formatPercent(s.avgReturn)} (n=${s.count})`}
          />
        );
      })}
      <StatBlock
        label="Best"
        value={stats.best ? `${stats.best.entry.ticker} ${formatPercent(stats.best.returnPct)}` : "—"}
      />
      <StatBlock
        label="Worst"
        value={stats.worst ? `${stats.worst.entry.ticker} ${formatPercent(stats.worst.returnPct)}` : "—"}
      />
    </div>
  );
}

export function BreakoutOutcomesPanel() {
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const { data, isLoading, isError } = useGetBreakoutOutcomes({
    query: { queryKey: getGetBreakoutOutcomesQueryKey(), refetchInterval: 60_000 },
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data];
    if (sortBy === "recent") return rows.sort((a, b) => b.loggedAt - a.loggedAt);
    return rows.sort((a, b) => {
      const av = latestAvailable(a)?.returnPct;
      const bv = latestAvailable(b)?.returnPct;
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return bv - av;
    });
  }, [data, sortBy]);

  const stats = useMemo(() => computeSummary(data ?? []), [data]);
  const lowSample = stats.total < LOW_SAMPLE_THRESHOLD;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/60">
        <h2 className="text-sm font-bold text-zinc-100">Breakout Candidate Outcomes</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Every stock ever flagged as a Top Breakout Candidate, tracked forward at 1/3/5/10 days — the honest record of whether this actually predicts anything. Winners and losers together, no curation.
        </p>
      </div>

      {isLoading && (
        <div className="p-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
        </div>
      )}
      {isError && <p className="text-sm text-red-400 px-4 py-4">Couldn't load breakout outcomes.</p>}

      {data && data.length === 0 && (
        <p className="text-sm text-zinc-500 px-4 py-6">
          No picks logged yet — this fills in automatically as stocks appear in Top Breakout Candidates.
        </p>
      )}

      {data && data.length > 0 && (
        <>
          <SummaryRow stats={stats} />

          {lowSample && (
            <div className="px-4 py-2 border-b border-amber-900/40 bg-amber-950/20 text-[11px] text-amber-300/90">
              ⚠ Early-stage feature — {stats.total} pick{stats.total === 1 ? "" : "s"} tracked so far. Win rates and averages above aren't statistically meaningful until this reaches roughly {LOW_SAMPLE_THRESHOLD}+ picks; treat them as a running log, not a verdict yet.
            </div>
          )}

          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-800/60">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wide">Sort</span>
            {(["recent", "return"] as SortKey[]).map(key => (
              <button
                key={key}
                onClick={() => setSortBy(key)}
                className={cn(
                  "text-[10px] font-medium px-2 py-0.5 rounded transition-colors",
                  sortBy === key ? "bg-amber-800/60 text-amber-200" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300",
                )}
              >
                {key === "recent" ? "Most Recent" : "By Return"}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/40 text-[10px] uppercase tracking-wide text-zinc-500">
                  <th className="py-2 px-4 font-medium">Ticker</th>
                  <th className="py-2 px-3 font-medium">Flagged</th>
                  <th className="py-2 px-3 font-medium text-right">Price Then</th>
                  <th className="py-2 px-3 font-medium">1D</th>
                  <th className="py-2 px-3 font-medium">3D</th>
                  <th className="py-2 px-3 font-medium">5D</th>
                  <th className="py-2 px-3 font-medium">10D</th>
                  <th className="py-2 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(entry => (
                  <tr key={entry.id} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                    <td className="py-2 px-4">
                      <div className="font-bold text-zinc-100">{entry.ticker}</div>
                      <div className="text-[10px] text-zinc-600 truncate max-w-[120px]">{entry.signalLabelAtLog}</div>
                    </td>
                    <td className="py-2 px-3 text-zinc-400 whitespace-nowrap">{entry.loggedDate}</td>
                    <td className="py-2 px-3 text-right font-mono text-zinc-300">${entry.priceAtLog.toFixed(2)}</td>
                    <td className="py-2 px-3"><CheckpointCell entry={entry} checkpointKey="d1" /></td>
                    <td className="py-2 px-3"><CheckpointCell entry={entry} checkpointKey="d3" /></td>
                    <td className="py-2 px-3"><CheckpointCell entry={entry} checkpointKey="d5" /></td>
                    <td className="py-2 px-3"><CheckpointCell entry={entry} checkpointKey="d10" /></td>
                    <td className="py-2 px-4 text-[10px]">
                      {entry.complete ? (
                        <span className="text-zinc-500">complete</span>
                      ) : entry.stillActive ? (
                        <span className="text-amber-400">still active</span>
                      ) : (
                        <span className="text-zinc-600">tracking</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
