# Atdevala Backtest Tools

## backtest.py — Level 2 Signal Validation

Tests two price-reconstructible signals over historical OHLCV data:

| Signal | What it tests |
|--------|--------------|
| **BPS proxy** | Breakout Probability Score reconstructed from INS/ACS/FBRS/MA proxies |
| **INS–COS gap** | Leading vs lagging signal divergence — the pre-breakout hypothesis |

### Setup (first time only)

```bash
cd tools
uv venv venv --python python3.11   # or: python3 -m venv venv
uv pip install --python venv/bin/python yfinance pandas numpy scipy
```

### Run

```bash
# Full 2-year backtest (recommended)
tools/venv/bin/python3 tools/backtest.py

# 1-year run (faster)
tools/venv/bin/python3 tools/backtest.py --years 1

# Custom output directory
tools/venv/bin/python3 tools/backtest.py --output tools/results
```

### Output

- `tools/results/bps_backtest.csv` — all ticker-date observations with BPS score + 4/8/12-week forward returns
- `tools/results/ins_cos_gap_backtest.csv` — all observations with INS, COS, gap + forward returns
- Printed summary: Information Coefficients, quartile returns, cohort analysis, verdict

### Reading the results

| Metric | Interpretation |
|--------|---------------|
| **IC > 0.10** | Strong — score has genuine predictive power |
| **IC 0.05–0.10** | Useful — directionally correct |
| **IC < 0.02** | Noise — no detectable edge |
| **Q4 vs Q1 spread** | Return difference between top and bottom quartile BPS stocks |
| **Leading cohort** | Stocks where INS proxy > COS proxy by >15 pts |

### Important caveat

This is a **price-only** backtest. The real BPS and CSOS also incorporate
fundamentals (LQS/VQS: margins, FCF, revenue growth) which cannot be
reconstructed from OHLCV history. Those components require either:
- Forward testing (already started — check in 2 weeks and 1 month)
- A paid fundamentals history provider (Polygon.io, Tiingo, etc.)
