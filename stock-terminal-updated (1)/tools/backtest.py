#!/usr/bin/env python3
"""
Atdevala Signal Backtest — Level 2
====================================
Tests two price-reconstructible signals over 2 years of OHLCV history:

  Signal 1 — BPS proxy  (Breakout Probability Score)
    Reconstructed from: INS proxy (35%) | ACS proxy (25%) | inverse-FBRS proxy (20%)
                        MA stack (15%) | growth proxy neutral (5%)

  Signal 2 — INS–COS gap  (leading vs lagging signal divergence)
    Hypothesis: when INS proxy leads COS proxy by >15 pts, forward returns
    are higher than average over the next 4–12 weeks.

Usage:
    python3 tools/backtest.py              # full 2-year run
    python3 tools/backtest.py --years 1    # 1-year run
    python3 tools/backtest.py --output tools/results

Outputs:
    tools/results/bps_backtest.csv         all ticker-date observations with BPS + fwd returns
    tools/results/ins_cos_gap_backtest.csv all ticker-date observations with gap + fwd returns
    Printed summary: ICs, quartile returns, cohort returns, verdict

NOTE: Fundamentals inputs (LQS, VQS, revenue/margin data) cannot be reconstructed
from price history alone and are NOT included here. This validates the signal-based
half of the system (INS, ACS, FBRS, MA stack). LQS/VQS require forward testing or
a paid fundamentals-history provider (e.g. Polygon.io, Tiingo).
"""

import sys
import argparse
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
import yfinance as yf

warnings.filterwarnings("ignore")

# ── Watchlist (148 tickers) ───────────────────────────────────────────────────

TICKERS = [
    # Quantum Computing
    "IONQ", "RGTI", "QBTS", "QUBT", "ARQQ", "LAES",
    # Semiconductors & Compute
    "NVDA", "AVGO", "LRCX", "AMD", "INTC", "ARM", "MRVL", "KLAC",
    "TSM", "ASML", "AMAT", "MU", "QCOM", "ON",
    # AI Picks & Shovels
    "NVTS", "AEHR", "CRDO", "ALGM", "HIMX", "MTSI", "AEVA", "SMCI",
    "SITM", "CEVA", "AUR", "OUST", "RMBS", "ONTO", "ACMR", "PI",
    "COHU", "MRAM", "NVEC",
    # Photonics & Optics
    "LITE", "COHR", "AAOI", "IPGP", "CIEN", "INFN", "VIAV", "ADTN", "CALX", "NOK",
    # DC Builders & Cooling
    "CAT", "FIX", "POWL", "VRT", "ETN", "IR", "HUBB", "STRL", "AGX",
    "EMR", "SPXC", "J", "DELL",
    # Power & Energy
    "GEV", "PWR", "BE", "OKLO", "CEG", "SMR", "NNE", "AMPX", "VST",
    "BWXT", "TLN", "NEE", "D",
    # Neoclouds & AI Software
    "MSFT", "NOW", "NBIS", "PLTR", "RBRK", "NET", "SNOW", "SOUN", "BB",
    "RDDT", "DDOG", "GTLB", "PATH", "MDB", "CRWD",
    # Defense & Drones
    "ONDS", "KTOS", "RCAT", "ACHR", "KRKNF", "AXON", "JOBY", "LDOS", "BAH", "SAIC",
    # Space Economy
    "RKLB", "ASTS", "LUNR", "IRDM", "VSAT", "GSAT", "BKSY", "RDW", "SPIR",
    # Biotech & Healthcare
    "RXRX", "SDGR", "ABCL", "TWST", "PACB", "BEAM", "VERV", "NTLA",
    "EDIT", "FATE", "HIMS", "ACCD",
    # Robotics & Automation
    "BDTX", "FARO", "ISRG", "GRAB", "RBOT", "GFAI", "BFLY", "TNDM", "AAON",
    # Fintech & Digital Finance
    "AFRM", "SOFI", "UPST", "NU", "HOOD", "MARA", "RIOT", "CLSK",
    "COIN", "PYPL", "BILL", "RELY",
    # Consumer & Platform Tech
    "MELI", "SHOP", "APP", "RBLX", "DUOL", "CAVA", "CELH", "DASH",
]

SPY = "SPY"

# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp(val: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, val))


# ── Signal proxies (per ticker, per date index) ───────────────────────────────

def ins_proxy(close: pd.Series, volume: pd.Series, spy: pd.Series, idx: int) -> float:
    """
    INS proxy — short-term momentum + relative strength vs SPY.
    Mirrors real INS: leads price, detects early breakout energy.
    Absolute thresholds: +10% excess RS → ~80 score, 0% → ~55, -10% → ~30.
    """
    if idx < 20:
        return 50.0

    # 1. 20-day excess return vs SPY (primary component, 35%)
    r20  = close.iloc[idx] / close.iloc[idx - 20] - 1
    s20  = spy.iloc[idx]   / spy.iloc[idx - 20]   - 1
    rs20 = (r20 - s20) * 100
    rs_score = clamp(55 + rs20 * 2.5)

    # 2. Momentum acceleration: 10d RS vs 20d RS (25%)
    r10  = close.iloc[idx] / close.iloc[idx - 10] - 1 if idx >= 10 else r20
    s10  = spy.iloc[idx]   / spy.iloc[idx - 10]   - 1 if idx >= 10 else s20
    rs10 = (r10 - s10) * 100
    accel = rs10 - rs20 * 0.5
    accel_score = clamp(50 + accel * 2.0)

    # 3. 52-week range position (25%)
    lookback = min(252, idx)
    hi52 = close.iloc[idx - lookback: idx + 1].max()
    lo52 = close.iloc[idx - lookback: idx + 1].min()
    pos52 = clamp((close.iloc[idx] - lo52) / (hi52 - lo52 + 1e-9) * 100)

    # 4. Volume acceleration: 5d vs 20d avg (15%)
    if idx >= 20:
        v5  = volume.iloc[idx - 5:  idx + 1].mean()
        v20 = volume.iloc[idx - 20: idx + 1].mean()
        vol_score = clamp(50 + (v5 / (v20 + 1e-9) - 1) * 50)
    else:
        vol_score = 50.0

    return clamp(0.35 * rs_score + 0.25 * accel_score + 0.25 * pos52 + 0.15 * vol_score)


def acs_proxy(close: pd.Series, volume: pd.Series, spy: pd.Series, idx: int) -> float:
    """
    ACS proxy — institutional accumulation pattern.
    Mirrors real ACS: relative strength, closing strength, up-volume ratio.
    """
    if idx < 15:
        return 50.0

    # 1. 20-day RS vs SPY (40%)
    if idx >= 20:
        rs = (close.iloc[idx] / close.iloc[idx - 20] - spy.iloc[idx] / spy.iloc[idx - 20]) * 100
        rs_score = clamp(50 + rs * 2.5)
    else:
        rs_score = 50.0

    # 2. Up-close ratio over last 10 days (35%)
    diffs = close.iloc[idx - 10: idx + 1].diff().dropna()
    up_ratio = (diffs > 0).mean() * 100
    close_score = clamp(up_ratio)

    # 3. Up-volume vs down-volume ratio (25%)
    if idx >= 20:
        ret_slice  = close.iloc[idx - 20: idx + 1].diff().dropna()
        vol_slice  = volume.iloc[idx - 19: idx + 1]
        up_vol     = vol_slice[ret_slice.values > 0].mean()
        down_vol   = vol_slice[ret_slice.values < 0].mean()
        vr         = (up_vol if not np.isnan(up_vol) else 1) / \
                     (down_vol if not np.isnan(down_vol) and down_vol > 0 else 1)
        vol_score  = clamp(50 + (vr - 1) * 30)
    else:
        vol_score = 50.0

    return clamp(0.40 * rs_score + 0.35 * close_score + 0.25 * vol_score)


def inv_fbrs_proxy(close: pd.Series, idx: int) -> float:
    """
    Inverse FBRS proxy — setup cleanliness.
    Low recent vol vs historical vol = compressed, clean setup = high score.
    Vol spike = hype / noise = low score.
    """
    if idx < 20:
        return 50.0

    rets = close.pct_change().dropna()
    lookback = min(60, idx)
    if len(rets) < 10:
        return 50.0

    vol10 = rets.iloc[max(0, idx - 10): idx].std() * np.sqrt(252) * 100
    vol60 = rets.iloc[max(0, idx - lookback): idx].std() * np.sqrt(252) * 100

    if vol60 < 1e-9:
        return 50.0

    ratio = vol10 / vol60
    # ratio < 0.7 → very compressed → ~85 score
    # ratio = 1.0 → neutral → ~50
    # ratio > 1.5 → spiking → ~20
    return clamp(100 - (ratio - 0.3) * 60)


def ma_stack_score(close: pd.Series, idx: int) -> float:
    """
    MA stack — price vs 50MA / 200MA + golden cross.
    Mirrors real BPS momentum component.
    """
    p = close.iloc[idx]
    ma50  = close.iloc[max(0, idx - 49):  idx + 1].mean()
    ma200 = close.iloc[max(0, idx - 199): idx + 1].mean()

    score = 30.0
    if p    > ma50:  score += 20.0
    if p    > ma200: score += 15.0
    if ma50 > ma200: score += 15.0   # golden cross / full bull stack

    # Distance above/below MA50 (±15 pts max)
    dist = (p / ma50 - 1) * 100 if ma50 > 0 else 0
    score += clamp(dist * 1.5, -15, 15)

    return clamp(score)


def bps_proxy(close: pd.Series, volume: pd.Series, spy: pd.Series, idx: int,
              cos_val: float | None = None) -> float:
    """
    BPS proxy — updated weights matching live formula (v2).
    Weights: 30% INS | 20% ACS | 20% inv-FBRS | 25% MA stack (↑) | 5% growth (neutral)
    + INS-COS gap step-function bonus: >25 pts gap → +8, >15 → +5, <-15 → -3
    NOTE: LQS multiplier (0.88–1.10) is omitted — no historical fundamentals available.
    """
    i   = ins_proxy(close, volume, spy, idx)
    a   = acs_proxy(close, volume, spy, idx)
    f   = inv_fbrs_proxy(close, idx)
    ma  = ma_stack_score(close, idx)
    raw = 0.30 * i + 0.20 * a + 0.20 * f + 0.25 * ma + 0.05 * 50.0

    # INS-COS gap step-function bonus (backtest-derived threshold effect)
    c   = cos_val if cos_val is not None else cos_proxy(close, spy, idx)
    gap = i - c
    bonus = 8.0 if gap > 25 else 5.0 if gap > 15 else -3.0 if gap < -15 else 0.0

    return round(clamp(raw + bonus), 1)


def cos_proxy(close: pd.Series, spy: pd.Series, idx: int) -> float:
    """
    COS proxy — longer-term momentum (what the market has already recognised).
    Uses 60-day RS vs SPY + MA context. Intentionally lags INS.
    """
    if idx < 30:
        return 50.0
    lookback = min(60, idx)
    rs60 = (close.iloc[idx] / close.iloc[idx - lookback] -
            spy.iloc[idx]   / spy.iloc[idx - lookback]) * 100
    rs_score = clamp(50 + rs60 * 1.5)
    ma = ma_stack_score(close, idx)
    return round(clamp(0.60 * rs_score + 0.40 * ma), 1)


# ── Backtest engine ───────────────────────────────────────────────────────────

FORWARD_TDS = {"4w": 20, "8w": 40, "12w": 60}


def run_backtest(
    ticker_data: dict[str, tuple[pd.Series, pd.Series]],
    spy_close: pd.Series,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    For each monthly rebalance date, score every ticker and record forward returns.
    Returns (bps_df, gap_df).
    """
    all_dates = spy_close.index

    # Monthly rebalance dates: last trading day of each month.
    # We include all dates — the forward return availability check (below) naturally
    # excludes dates too close to the end of the data.
    monthly_end = spy_close.resample("ME").last().index
    rebal_dates = list(monthly_end)

    bps_rows, gap_rows = [], []

    total = len(rebal_dates) * len(ticker_data)
    done  = 0

    for rebal in rebal_dates:
        spy_idx = int(all_dates.searchsorted(rebal))

        for ticker, (close, volume) in ticker_data.items():
            done += 1
            if done % 200 == 0:
                pct = done / total * 100
                print(f"  Progress: {done}/{total} ({pct:.0f}%)", end="\r")

            try:
                # Need 40 days of history before this date
                if spy_idx < 40:
                    continue
                if pd.isna(close.iloc[spy_idx]) or close.iloc[spy_idx] <= 0:
                    continue

                price0 = close.iloc[spy_idx]

                # Forward returns
                fwds: dict[str, float] = {}
                for label, td in FORWARD_TDS.items():
                    fi = spy_idx + td
                    if fi < len(close) and not pd.isna(close.iloc[fi]) and close.iloc[fi] > 0:
                        fwds[label] = round((close.iloc[fi] / price0 - 1) * 100, 2)

                # Need at least 4w forward return
                if "4w" not in fwds:
                    continue

                ins  = ins_proxy(close, volume, spy_close, spy_idx)
                cos  = cos_proxy(close, spy_close, spy_idx)
                gap  = round(ins - cos, 1)
                bps  = bps_proxy(close, volume, spy_close, spy_idx, cos_val=cos)

                base = {
                    "date":   rebal.date(),
                    "ticker": ticker,
                    "fwd_4w":  fwds.get("4w"),
                    "fwd_8w":  fwds.get("8w"),
                    "fwd_12w": fwds.get("12w"),
                }
                bps_rows.append({**base, "bps": bps, "ins": round(ins, 1), "cos": round(cos, 1)})
                gap_rows.append({**base, "ins": round(ins, 1), "cos": round(cos, 1), "gap": gap})

            except Exception:
                continue

    print()
    return pd.DataFrame(bps_rows), pd.DataFrame(gap_rows)


# ── Analysis helpers ──────────────────────────────────────────────────────────

def spearman_ic(df: pd.DataFrame, score_col: str, fwd_col: str) -> float:
    """Average per-date Spearman rank correlation between score and forward return."""
    ics = []
    for _, grp in df.dropna(subset=[score_col, fwd_col]).groupby("date"):
        if len(grp) < 8:
            continue
        ic, _ = stats.spearmanr(grp[score_col], grp[fwd_col])
        if not np.isnan(ic):
            ics.append(ic)
    return round(float(np.mean(ics)), 4) if ics else float("nan")


def ic_label(ic: float) -> str:
    a = abs(ic)
    if a > 0.10: return "STRONG"
    if a > 0.05: return "USEFUL"
    if a > 0.02: return "WEAK"
    return "NOISE"


def quartile_returns(df: pd.DataFrame, score_col: str) -> pd.DataFrame:
    """Assign per-date score quartiles and return grouped summary."""
    df = df.copy()

    def assign_q(x: pd.Series) -> pd.Series:
        try:
            return pd.qcut(x, q=4, labels=["Q1 (low)", "Q2", "Q3", "Q4 (high)"],
                           duplicates="drop")
        except ValueError:
            return pd.Series(["Q2"] * len(x), index=x.index)

    df["quartile"] = df.groupby("date")[score_col].transform(assign_q)
    return df


# ── Output ────────────────────────────────────────────────────────────────────

HORIZONS = ["fwd_4w", "fwd_8w", "fwd_12w"]
H_LABELS  = {"fwd_4w": "4w", "fwd_8w": "8w", "fwd_12w": "12w"}


def print_summary(bps_df: pd.DataFrame, gap_df: pd.DataFrame) -> None:
    w = 72
    bar = "=" * w

    print(f"\n{bar}")
    print("  ATDEVALA SIGNAL BACKTEST — RESULTS SUMMARY")
    print(bar)
    print(f"  Period : {bps_df['date'].min()}  →  {bps_df['date'].max()}")
    print(f"  Tickers: {bps_df['ticker'].nunique()} with sufficient price history")
    print(f"  Obs    : {len(bps_df):,} ticker-date pairs (4w fwd return available)")

    # ── BPS Information Coefficients ─────────────────────────────────────────
    print(f"\n{'─'*w}")
    print("  BPS PROXY — Information Coefficient (Spearman rank correlation)")
    print("  IC > 0.10 = STRONG  |  > 0.05 = USEFUL  |  > 0.02 = WEAK  |  else NOISE")
    print(f"{'─'*w}")
    print(f"  {'Horizon':<10}  {'IC':>8}  {'Rating'}")
    for h in HORIZONS:
        ic = spearman_ic(bps_df, "bps", h)
        print(f"  {H_LABELS[h]:<10}  {ic:>8.4f}  {ic_label(ic)}")

    # ── BPS Quartile Returns ──────────────────────────────────────────────────
    print(f"\n{'─'*w}")
    print("  BPS PROXY — Mean Forward Returns by Score Quartile")
    print(f"{'─'*w}")
    bps_q = quartile_returns(bps_df, "bps")
    grp   = bps_q.groupby("quartile", observed=True)
    hdr   = f"  {'Quartile':<14}" + "".join(f"  {H_LABELS[h]:>8}" for h in HORIZONS) + f"  {'Hit% 8w':>8}  {'N':>6}"
    print(hdr)
    q_means: dict[str, dict] = {}
    for qt in ["Q1 (low)", "Q2", "Q3", "Q4 (high)"]:
        if qt not in grp.groups:
            continue
        g = grp.get_group(qt)
        vals = [f"{g[h].mean():>+7.2f}%" if h in g and not g[h].isna().all() else f"{'—':>8}" for h in HORIZONS]
        hit8 = (g["fwd_8w"] > 0).mean() * 100 if "fwd_8w" in g else float("nan")
        print(f"  {qt:<14}" + "".join(f"  {v:>8}" for v in vals) + f"  {hit8:>7.1f}%  {len(g):>6}")
        q_means[qt] = {h: g[h].mean() for h in HORIZONS}

    spread = float("nan")
    if "Q4 (high)" in q_means and "Q1 (low)" in q_means:
        spread = q_means["Q4 (high)"].get("fwd_8w", 0) - q_means["Q1 (low)"].get("fwd_8w", 0)
        print(f"\n  Q4 vs Q1 spread (8w): {spread:+.2f}%  "
              f"({'positive edge' if spread > 0 else 'no edge detected'})")

    # ── INS–COS Gap ───────────────────────────────────────────────────────────
    print(f"\n{'─'*w}")
    print("  INS–COS GAP — Cohort Forward Returns")
    print("  Hypothesis: stocks where INS proxy leads COS proxy (gap > +15)")
    print("  should outperform stocks where COS leads INS (gap < -10)")
    print(f"{'─'*w}")
    gap_df2 = gap_df.copy()
    gap_df2["cohort"] = pd.cut(
        gap_df2["gap"],
        bins=[-np.inf, -10, 15, np.inf],
        labels=["Trailing (COS > INS)", "Neutral", "Leading (INS > COS)"],
    )
    grp2 = gap_df2.groupby("cohort", observed=True)
    print(f"  {'Cohort':<22}" + "".join(f"  {H_LABELS[h]:>8}" for h in HORIZONS) + f"  {'Hit% 8w':>8}  {'N':>6}")
    for cohort in ["Leading (INS > COS)", "Neutral", "Trailing (COS > INS)"]:
        if cohort not in grp2.groups:
            continue
        g = grp2.get_group(cohort)
        vals = [f"{g[h].mean():>+7.2f}%" if h in g and not g[h].isna().all() else f"{'—':>8}" for h in HORIZONS]
        hit8 = (g["fwd_8w"] > 0).mean() * 100 if "fwd_8w" in g else float("nan")
        print(f"  {cohort:<22}" + "".join(f"  {v:>8}" for v in vals) + f"  {hit8:>7.1f}%  {len(g):>6}")

    print(f"\n{'─'*w}")
    print("  INS–COS GAP — Information Coefficients")
    print(f"{'─'*w}")
    print(f"  {'Horizon':<10}  {'IC':>8}  {'Rating'}")
    for h in HORIZONS:
        ic = spearman_ic(gap_df2, "gap", h)
        print(f"  {H_LABELS[h]:<10}  {ic:>8.4f}  {ic_label(ic)}")

    # ── Verdict ───────────────────────────────────────────────────────────────
    ic_bps = spearman_ic(bps_df, "bps", "fwd_8w")
    ic_gap = spearman_ic(gap_df2, "gap", "fwd_8w")

    print(f"\n{'─'*w}")
    print("  VERDICT")
    print(f"{'─'*w}")

    if not np.isnan(ic_bps):
        if abs(ic_bps) > 0.10 and spread > 5:
            v = "STRONG — BPS proxy has genuine predictive edge in this period."
        elif abs(ic_bps) > 0.05 or spread > 2:
            v = "PROMISING — Directionally correct. Some edge present."
        else:
            v = "INCONCLUSIVE — No clear edge detected from price signals alone."
        print(f"  BPS proxy  (8w IC={ic_bps:+.4f}, Q4–Q1={spread:+.2f}%): {v}")

    if not np.isnan(ic_gap):
        if abs(ic_gap) > 0.10:
            v = "STRONG — INS leading COS is a valid pre-breakout signal."
        elif abs(ic_gap) > 0.05:
            v = "PROMISING — INS–COS gap has directional predictive value."
        else:
            v = "INCONCLUSIVE — Gap signal not validated on price data alone."
        print(f"  INS–COS gap (8w IC={ic_gap:+.4f}): {v}")

    print(f"\n  CAVEAT: This is a price-only backtest. The real BPS and CSOS also")
    print(f"  incorporate fundamentals (LQS/VQS: margins, FCF, revenue growth)")
    print(f"  which are not reconstructible from OHLCV. Run forward tests for")
    print(f"  those components — you've already started tracking them.")
    print(f"{bar}\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Atdevala signal backtest (Level 2)")
    parser.add_argument("--years",  type=float, default=2.0,
                        help="Years of history to use (default: 2)")
    parser.add_argument("--output", type=str,   default="tools/results",
                        help="Output directory for CSV files (default: tools/results)")
    args = parser.parse_args()

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    period = f"{max(1, int(args.years * 12))}mo"
    all_tickers = TICKERS + [SPY]

    print(f"\nDownloading {len(all_tickers)} tickers ({period} daily OHLCV from Yahoo Finance)...")
    raw = yf.download(
        tickers=all_tickers,
        period=period,
        interval="1d",
        auto_adjust=True,
        progress=True,
        threads=True,
    )

    # ── Extract SPY ───────────────────────────────────────────────────────────
    if isinstance(raw.columns, pd.MultiIndex):
        spy_close = raw["Close"][SPY].dropna()
    else:
        spy_close = raw["Close"].dropna()

    all_dates = spy_close.index

    # ── Extract per-ticker aligned series ────────────────────────────────────
    ticker_data: dict[str, tuple[pd.Series, pd.Series]] = {}
    skipped = []
    for t in TICKERS:
        try:
            if isinstance(raw.columns, pd.MultiIndex):
                c = raw["Close"][t].reindex(all_dates).ffill()
                v = raw["Volume"][t].reindex(all_dates).ffill().fillna(0)
            else:
                continue
            valid = c.dropna()
            if len(valid) >= 80:
                ticker_data[t] = (c, v)
            else:
                skipped.append(t)
        except Exception:
            skipped.append(t)

    print(f"  Loaded : {len(ticker_data)}/{len(TICKERS)} tickers (≥80 days of history)")
    if skipped:
        print(f"  Skipped: {', '.join(skipped)} (insufficient history)")

    print("Running backtest (scoring every ticker at each monthly rebalance date)...")
    bps_df, gap_df = run_backtest(ticker_data, spy_close)

    if bps_df.empty:
        print("\nERROR: No records generated — check data download above.")
        sys.exit(1)

    bps_path = out_dir / "bps_backtest.csv"
    gap_path = out_dir / "ins_cos_gap_backtest.csv"
    bps_df.to_csv(bps_path, index=False)
    gap_df.to_csv(gap_path, index=False)
    print(f"\n  Saved: {bps_path}  ({len(bps_df):,} rows)")
    print(f"  Saved: {gap_path}  ({len(gap_df):,} rows)")

    print_summary(bps_df, gap_df)


if __name__ == "__main__":
    main()
