
"""
Watchlist export to Google Sheets.

- Dashboard tab: compact stock list by category + news feed below
- All price/metric columns use =GOOGLEFINANCE() → auto-updates every ~20 min
- Analyst ratings + technical signals fetched from yfinance on export
- No TradingView API needed — GOOGLEFINANCE covers all the same data
"""

import os, sys, json, textwrap
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials
import yfinance as yf

sys.path.insert(0, os.path.dirname(__file__))
from generate_financial_tracker import CATEGORIES

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── Palette ───────────────────────────────────────────────────────────────────
WHITE      = "FFFFFF"
DARK_BLUE  = "1B2A4A"
YELLOW_IN  = "FFF2CC"   # user-editable cells
ALERT_ORG  = "FF6600"

def color(h):
    h = h.lstrip("#")
    return {"red": int(h[0:2],16)/255, "green": int(h[2:4],16)/255, "blue": int(h[4:6],16)/255}

def col_letter(n):
    result = ""
    while n:
        n, r = divmod(n - 1, 26)
        result = chr(65 + r) + result
    return result


# ── Watchlist columns ─────────────────────────────────────────────────────────
# Yellow = user input | Everything else = live GOOGLEFINANCE formula
WATCH_COLS = [
    # (header,               width_px, user_input)
    ("Ticker",               70,  False),   # A — static text
    ("Company",              160, False),   # B — static text
    ("Focus / Niche",        160, False),   # C — static text
    ("Risk",                 75,  False),   # D — static text
    ("Live Price",           80,  False),   # E — GOOGLEFINANCE
    ("Today's %",            75,  False),   # F — GOOGLEFINANCE
    ("1-Week %",             75,  False),   # G — GOOGLEFINANCE
    ("1-Month %",            80,  False),   # H — GOOGLEFINANCE
    ("3-Month %",            80,  False),   # I — GOOGLEFINANCE
    ("YTD %",                75,  False),   # J — GOOGLEFINANCE
    ("52W High",             80,  False),   # K — GOOGLEFINANCE
    ("52W Low",              80,  False),   # L — GOOGLEFINANCE
    ("% from 52W High",      100, False),   # M — formula
    ("P/E Ratio",            75,  False),   # N — GOOGLEFINANCE
    ("Market Cap",           100, False),   # O — GOOGLEFINANCE
    ("Volume",               90,  False),   # P — GOOGLEFINANCE
    ("Analyst Target",       90,  True),    # Q — user input (yellow)
    ("Upside to Target",     90,  False),   # R — formula
    ("Price Alert",          130, False),   # S — formula (buy zone flag)
]
N_COLS = len(WATCH_COLS)


def gf(ticker, attr):
    """Return a GOOGLEFINANCE formula string."""
    return f'=GOOGLEFINANCE("{ticker}","{attr}")'


def build_watchlist_sheet(spreadsheet, cat, sheet_id_map):
    """Create one watchlist tab for a category."""
    stocks  = cat["stocks"]
    cat_hex = cat["color"]
    name    = cat["name"]

    try:
        ws = spreadsheet.add_worksheet(title=name, rows=300, cols=N_COLS + 2)
    except Exception:
        ws = spreadsheet.worksheet(name)

    sheet_id = ws._properties["sheetId"]

    headers = [c[0] for c in WATCH_COLS]
    last_col = col_letter(N_COLS)

    # ── Row values ────────────────────────────────────────────────────────────
    all_values = []

    # Row 1: category title
    all_values.append([name] + [""] * (N_COLS - 1))
    # Row 2: description
    all_values.append([cat.get("description", "")] + [""] * (N_COLS - 1))
    # Row 3: legend
    all_values.append(
        ["🟡 Yellow cells = your inputs  |  All other data is LIVE via Google Finance (auto-refreshes every ~20 min)"]
        + [""] * (N_COLS - 1)
    )
    # Row 4: column headers
    all_values.append(headers)

    first_data = 5   # 1-based row index of first stock
    for stock in stocks:
        t = stock["ticker"]
        row = [
            t,                                          # A ticker
            stock["company"],                           # B company
            stock["focus"],                             # C focus
            stock["risk"],                              # D risk
            gf(t, "price"),                             # E live price
            f'=IFERROR(GOOGLEFINANCE("{t}","changepct")/100,"")',  # F today %
            # G 1-Week: price vs first trading day in the past ~10 calendar days
            f'=IFERROR(GOOGLEFINANCE("{t}","price")/INDEX(GOOGLEFINANCE("{t}","price",TODAY()-10,TODAY()-1),2,2)-1,"")',
            # H 1-Month: price vs first trading day ~35 calendar days ago
            f'=IFERROR(GOOGLEFINANCE("{t}","price")/INDEX(GOOGLEFINANCE("{t}","price",TODAY()-35,TODAY()-1),2,2)-1,"")',
            # I 3-Month: price vs first trading day ~95 calendar days ago
            f'=IFERROR(GOOGLEFINANCE("{t}","price")/INDEX(GOOGLEFINANCE("{t}","price",TODAY()-95,TODAY()-1),2,2)-1,"")',
            # J YTD: price vs first trading day of this year
            f'=IFERROR(GOOGLEFINANCE("{t}","price")/INDEX(GOOGLEFINANCE("{t}","price",DATE(YEAR(TODAY()),1,2),TODAY()-1),2,2)-1,"")',
            gf(t, "high52"),                            # K 52W High
            gf(t, "low52"),                             # L 52W Low
            f'=IFERROR(E{first_data + len(all_values) - 4}/K{first_data + len(all_values) - 4}-1,"")',  # M % from 52W Hi
            gf(t, "pe"),                                # N P/E
            gf(t, "marketcap"),                         # O market cap
            gf(t, "volume"),                            # P volume
            "",                                         # Q analyst target (user fills)
            f'=IFERROR(Q{first_data + len(all_values) - 4}/E{first_data + len(all_values) - 4}-1,"")',  # R upside
            f'=IF(AND(K{first_data + len(all_values) - 4}>0,E{first_data + len(all_values) - 4}>0,M{first_data + len(all_values) - 4}<-0.2),"▼  BUY ZONE  (-20%+ off 52W high)","—")',  # S alert
        ]
        all_values.append(row)

    last_data = first_data + len(stocks) - 1

    # Notes section
    notes_start = last_data + 3
    while len(all_values) < notes_start - 1:
        all_values.append([""] * N_COLS)
    all_values.append(["INVESTMENT THESIS & RESEARCH NOTES"] + [""] * (N_COLS - 1))

    WRAP_WIDTH = 60
    nr_idx = notes_start  # 1-based row of next notes row to add
    for j, stock in enumerate(stocks):
        note_text = stock.get("notes", "")
        all_values.append(
            [stock["ticker"],
             f"  {stock['company']}   |   Risk: {stock['risk']}"]
            + [""] * (N_COLS - 2)
        )
        nr_idx += 1
        lines = textwrap.wrap(note_text, width=WRAP_WIDTH) if note_text else ["(no notes)"]
        all_values.append(["", "\n".join(lines)] + [""] * (N_COLS - 2))
        nr_idx += 1
        all_values.append([""] * N_COLS)   # gap
        nr_idx += 1

    # ── News Feed section (below notes) ───────────────────────────────────────
    # News cols: Ticker | Company | Headline | Published (4 cols, fits in N_COLS)
    news_section_r0 = len(all_values)   # 0-based
    all_values.append(["📰  LATEST NEWS"] + [""] * (N_COLS - 1))
    all_values.append(["Ticker", "Company", "Headline", "Published"]
                      + [""] * (N_COLS - 4))

    news_row_info = []   # (0-based index, ticker) for formatting
    alt = 0
    ticker_alt = {}
    for stock in stocks:
        t = stock["ticker"]
        if t not in ticker_alt:
            ticker_alt[t] = alt
            alt = 1 - alt
        try:
            items = yf.Ticker(t).news or []
            if not items:
                idx = len(all_values)
                all_values.append([t, stock["company"], "(no recent news)", ""]
                                  + [""] * (N_COLS - 4))
                news_row_info.append((idx, t))
                continue
            for item in items[:4]:
                content  = item.get("content", {})
                headline = content.get("title") or item.get("title", "No title")
                pub_ts   = content.get("pubDate") or item.get("providerPublishTime")
                if isinstance(pub_ts, (int, float)):
                    pub = datetime.fromtimestamp(pub_ts).strftime("%Y-%m-%d %H:%M")
                elif isinstance(pub_ts, str):
                    pub = pub_ts[:16]
                else:
                    pub = ""
                idx = len(all_values)
                all_values.append([t, stock["company"], headline, pub]
                                  + [""] * (N_COLS - 4))
                news_row_info.append((idx, t))
        except Exception as e:
            idx = len(all_values)
            all_values.append([t, stock["company"], f"(error fetching news: {e})", ""]
                              + [""] * (N_COLS - 4))
            news_row_info.append((idx, t))
        all_values.append([""] * N_COLS)   # gap between stocks

    # Write all values
    ws.update(all_values, "A1", value_input_option="USER_ENTERED")

    # ── Batch format requests ─────────────────────────────────────────────────
    reqs = []

    def rng(r0, r1, c0, c1):
        return {"sheetId": sheet_id, "startRowIndex": r0, "endRowIndex": r1,
                "startColumnIndex": c0, "endColumnIndex": c1}

    def fmt_req(r0, r1, c0, c1, bg=None, bold=False, fg="000000", size=10,
                italic=False, h="CENTER", wrap=False, fmt=None):
        obj = {
            "textFormat": {"bold": bold, "italic": italic, "fontSize": size,
                           "foregroundColor": color(fg)},
            "horizontalAlignment": h,
            "verticalAlignment": "MIDDLE",
        }
        if bg:
            obj["backgroundColor"] = color(bg)
        if wrap:
            obj["wrapStrategy"] = "WRAP"
        if fmt:
            obj["numberFormat"] = fmt
        return {"repeatCell": {"range": rng(r0, r1, c0, c1),
                               "cell": {"userEnteredFormat": obj},
                               "fields": "userEnteredFormat"}}

    def merge(r0, r1, c0, c1):
        return {"mergeCells": {"range": rng(r0, r1, c0, c1), "mergeType": "MERGE_ALL"}}

    # Title / desc / legend rows
    reqs += [merge(0,1,0,N_COLS), fmt_req(0,1,0,N_COLS, bg=cat_hex, bold=True, fg=WHITE, size=14)]
    reqs += [merge(1,2,0,N_COLS), fmt_req(1,2,0,N_COLS, bg="D9E1F2", italic=True, fg=DARK_BLUE, h="LEFT")]
    reqs += [merge(2,3,0,N_COLS), fmt_req(2,3,0,N_COLS, bg=YELLOW_IN, italic=True, fg="7F6000", size=9)]
    reqs.append(fmt_req(3,4,0,N_COLS, bg=cat_hex, bold=True, fg=WHITE, size=10))

    # Row height for title/legend
    for r0, px in [(0,30),(1,20),(2,18),(3,32)]:
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS",
                      "startIndex": r0, "endIndex": r0+1},
            "properties": {"pixelSize": px}, "fields": "pixelSize"}})

    # Data rows
    for i in range(len(stocks)):
        r0 = first_data - 1 + i
        bg = "F2F2F2" if i % 2 == 0 else WHITE
        reqs.append(fmt_req(r0, r0+1, 0, N_COLS, bg=bg, size=10))
        # Yellow for user-input col Q (index 16)
        reqs.append(fmt_req(r0, r0+1, 16, 17, bg=YELLOW_IN, size=10))
        # % formatting for F, G, H, I, J, M, R (indices 5,6,7,8,9,12,17)
        for ci in [5,6,7,8,9,12,17]:
            reqs.append(fmt_req(r0, r0+1, ci, ci+1, bg=bg if ci != 16 else YELLOW_IN,
                                fmt={"type":"PERCENT","pattern":"0.00%"}, size=10))
        # Currency for E, K, L, Q (indices 4,10,11,16)
        for ci in [4,10,11,16]:
            reqs.append(fmt_req(r0, r0+1, ci, ci+1, bg=YELLOW_IN if ci==16 else bg,
                                fmt={"type":"CURRENCY","pattern":'"$"#,##0.00'}, size=10))
        # Row height
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS",
                      "startIndex": r0, "endIndex": r0+1},
            "properties": {"pixelSize": 22}, "fields": "pixelSize"}})

    # Notes header
    nh0 = notes_start - 1
    reqs += [merge(nh0, nh0+1, 0, N_COLS),
             fmt_req(nh0, nh0+1, 0, N_COLS, bg=cat_hex, bold=True, fg=WHITE, size=11, h="LEFT")]

    # Notes rows
    nbase = nh0 + 1
    for j in range(len(stocks)):
        label_r = nbase + j * 3
        note_r  = label_r + 1
        bg_note = "F5F5F5" if j % 2 == 0 else WHITE
        reqs += [merge(label_r, label_r+1, 0, N_COLS),
                 fmt_req(label_r, label_r+1, 0, N_COLS, bg="D9E1F2", bold=True,
                         fg=DARK_BLUE, size=11, h="LEFT")]
        reqs += [merge(note_r, note_r+1, 1, N_COLS),
                 fmt_req(note_r, note_r+1, 0, 1, bg=bg_note),
                 fmt_req(note_r, note_r+1, 1, N_COLS, bg=bg_note, fg=DARK_BLUE,
                         size=10, h="LEFT", wrap=True)]
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS",
                      "startIndex": note_r, "endIndex": note_r+1},
            "properties": {"pixelSize": 200}, "fields": "pixelSize"}})

    # ── News section formatting ────────────────────────────────────────────────
    # news_section_r0 is 0-based index of the "📰 LATEST NEWS" header row
    news_h0 = news_section_r0
    news_col_h = news_h0 + 1   # column header row

    reqs += [merge(news_h0, news_h0+1, 0, N_COLS),
             fmt_req(news_h0, news_h0+1, 0, N_COLS, bg=cat_hex, bold=True,
                     fg=WHITE, size=12, h="LEFT")]
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sheet_id, "dimension": "ROWS",
                  "startIndex": news_h0, "endIndex": news_h0+1},
        "properties": {"pixelSize": 28}, "fields": "pixelSize"}})
    reqs.append(fmt_req(news_col_h, news_col_h+1, 0, N_COLS,
                        bg=DARK_BLUE, bold=True, fg=WHITE, size=10, h="CENTER"))
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sheet_id, "dimension": "ROWS",
                  "startIndex": news_col_h, "endIndex": news_col_h+1},
        "properties": {"pixelSize": 24}, "fields": "pixelSize"}})

    for nr0, t in news_row_info:
        bg = "EBF3FB" if ticker_alt.get(t, 0) == 0 else "FFFFFF"
        reqs.append(fmt_req(nr0, nr0+1, 0, N_COLS, bg=bg, size=10))
        reqs.append(fmt_req(nr0, nr0+1, 0, 1, bg=bg, bold=True, fg="0070C0", size=10))
        # Headline col (C=2) — wrap text
        reqs.append(fmt_req(nr0, nr0+1, 2, 3, bg=bg, size=10, wrap=True, h="LEFT"))
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS",
                      "startIndex": nr0, "endIndex": nr0+1},
            "properties": {"pixelSize": 34}, "fields": "pixelSize"}})

    # Conditional formatting — alert col S orange
    reqs.append({"addConditionalFormatRule": {"rule": {
        "ranges": [rng(first_data-1, last_data, 18, 19)],
        "booleanRule": {
            "condition": {"type": "CUSTOM_FORMULA",
                          "values": [{"userEnteredValue": f"=$M{first_data}<-0.2"}]},
            "format": {"backgroundColor": color(ALERT_ORG),
                       "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
        }}, "index": 0}})
    # Soft orange wash on whole row
    reqs.append({"addConditionalFormatRule": {"rule": {
        "ranges": [rng(first_data-1, last_data, 0, N_COLS-1)],
        "booleanRule": {
            "condition": {"type": "CUSTOM_FORMULA",
                          "values": [{"userEnteredValue": f"=$M{first_data}<-0.2"}]},
            "format": {"backgroundColor": color("FFF0E0")},
        }}, "index": 1}})

    # Green/red conditional on Today's % column (F, index 5)
    reqs.append({"addConditionalFormatRule": {"rule": {
        "ranges": [rng(first_data-1, last_data, 5, 6)],
        "booleanRule": {
            "condition": {"type": "NUMBER_GREATER", "values": [{"userEnteredValue": "0"}]},
            "format": {"backgroundColor": color("375623"),
                       "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
        }}, "index": 2}})
    reqs.append({"addConditionalFormatRule": {"rule": {
        "ranges": [rng(first_data-1, last_data, 5, 6)],
        "booleanRule": {
            "condition": {"type": "NUMBER_LESS", "values": [{"userEnteredValue": "0"}]},
            "format": {"backgroundColor": color("9C0006"),
                       "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
        }}, "index": 3}})

    # Column widths
    for ci, (_, px, _) in enumerate(WATCH_COLS):
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "COLUMNS",
                      "startIndex": ci, "endIndex": ci+1},
            "properties": {"pixelSize": px}, "fields": "pixelSize"}})

    # Freeze rows 1-4 only (no column freeze — conflicts with row-spanning merges)
    reqs.append({"updateSheetProperties": {
        "properties": {"sheetId": sheet_id,
                       "gridProperties": {"frozenRowCount": 4, "frozenColumnCount": 0}},
        "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount"}})

    # Tab colour
    reqs.append({"updateSheetProperties": {
        "properties": {"sheetId": sheet_id, "tabColor": color(cat_hex)},
        "fields": "tabColor"}})

    spreadsheet.batch_update({"requests": reqs})
    print(f"  ✓  {name}")
    return sheet_id


# ── Dashboard columns (compact watchlist) ─────────────────────────────────────
DASH_COLS = [
    ("Ticker",           58),   # A — static text
    ("Company",         155),   # B — static text
    ("Live Price",       82),   # C — GOOGLEFINANCE
    ("Today %",          72),   # D — GOOGLEFINANCE
    ("Ext Hrs %",        78),   # E — static from yfinance (pre/post market)
    ("vs 52W High",      98),   # F — GOOGLEFINANCE formula
    ("Analyst Rating",  148),   # G — static from yfinance
    ("Price Target",     90),   # H — static from yfinance
    ("Technical Signal",170),   # I — static from yfinance
]
N_DASH = len(DASH_COLS)

RATING_MAP = {
    "strong_buy":  "⭐ Strong Buy",
    "buy":         "✓ Buy",
    "hold":        "◯ Hold",
    "underperform":"↓ Underperform",
    "sell":        "✗ Sell",
    "strong_sell": "✗ Strong Sell",
}


def fetch_analyst_data():
    """Pull analyst ratings + technical signals for all tickers via yfinance."""
    print("  Fetching analyst data & technical signals from Yahoo Finance...")
    all_stocks = []
    for cat in CATEGORIES:
        for s in cat["stocks"]:
            all_stocks.append(s)

    result = {}
    for s in all_stocks:
        t = s["ticker"]
        try:
            info = yf.Ticker(t).info
            rec        = info.get("recommendationKey", "") or ""
            n_analysts = info.get("numberOfAnalystOpinions") or 0
            target     = info.get("targetMeanPrice")
            ma50       = info.get("fiftyDayAverage")
            ma200      = info.get("twoHundredDayAverage")
            price      = info.get("currentPrice") or info.get("regularMarketPrice")

            rating = RATING_MAP.get(rec.lower(), "—")
            if n_analysts and rating != "—":
                rating += f"  ({int(n_analysts)})"

            tech = "—"
            if price and ma50 and ma200:
                a50, a200 = price > ma50, price > ma200
                if a50 and a200:
                    tech = "↑ Bullish (>50 & 200MA)"
                elif a50:
                    tech = "→ Mixed  (>50MA, <200MA)"
                elif a200:
                    tech = "→ Mixed  (<50MA, >200MA)"
                else:
                    tech = "↓ Bearish (<50 & 200MA)"
            elif price and ma50:
                tech = ("↑ Above 50MA" if price > ma50 else "↓ Below 50MA")

            # Extended hours % — prefer post-market, fall back to pre-market
            # yfinance returns these as plain % numbers (e.g. -1.23 means -1.23%)
            ext_pct = None
            post = info.get("postMarketChangePercent")
            pre  = info.get("preMarketChangePercent")
            if post is not None:
                ext_pct = post / 100      # → decimal for % cell format
            elif pre is not None:
                ext_pct = pre / 100

            result[t] = {
                "rating":    rating,
                "target":    f"${target:,.2f}" if target else "—",
                "technical": tech,
                "ext_pct":   ext_pct,     # None → "—" when writing
            }
        except Exception:
            result[t] = {"rating": "—", "target": "—", "technical": "—", "ext_pct": None}

    found = sum(1 for v in result.values() if v["rating"] != "—")
    print(f"  ✓  Analyst data: {found}/{len(result)} tickers")
    return result


# ── Dashboard sheet ────────────────────────────────────────────────────────────
def build_dashboard_sheet(spreadsheet, analyst_data, cat_sheet_ids):
    """
    Single Dashboard tab:
      • Top — compact watchlist grouped by category
      • Bottom — news feed (all tickers, 3 headlines each)
    """
    try:
        ws = spreadsheet.add_worksheet(title="📊 Dashboard", rows=3000, cols=N_DASH + 1)
    except Exception:
        ws = spreadsheet.worksheet("📊 Dashboard")

    sheet_id = ws._properties["sheetId"]

    # ── Build row data ─────────────────────────────────────────────────────────
    rows = []

    def blank(): return [""] * N_DASH

    # Title block
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    rows.append([f"📊  STOCK WATCHLIST DASHBOARD"] + [""] * (N_DASH - 1))
    rows.append([f"Prices auto-refresh every ~20 min via Google Finance  |  Analyst data last updated: {now_str}"]
                + [""] * (N_DASH - 1))
    rows.append([c[0] for c in DASH_COLS])   # row 3 = column headers
    HEADER_ROWS = 3   # rows before first stock (0-indexed: 0,1,2)

    # Track row index (0-based) for GOOGLEFINANCE formula references
    current_row = HEADER_ROWS  # 0-based index of next row to write

    # Per-category compact watchlist
    cat_row_ranges = []   # (cat_hex, cat_r0, cat_r1) for colour formatting
    stock_row_info = []   # (0-based row, ticker) for conditional formats

    for cat in CATEGORIES:
        if not cat["stocks"]:
            continue

        cat_hex = cat["color"]
        cat_r0  = current_row

        # Category header — hyperlink to the category tab
        gid = cat_sheet_ids.get(cat["name"])
        cat_link = (f'=HYPERLINK("#gid={gid}","{cat["name"]}")'
                    if gid else cat["name"])
        rows.append([cat_link] + [""] * (N_DASH - 1))
        current_row += 1

        for s in cat["stocks"]:
            t  = s["ticker"]
            gf_price = f'=IFERROR(GOOGLEFINANCE("{t}","price"),"")'
            gf_pct   = f'=IFERROR(GOOGLEFINANCE("{t}","changepct")/100,"")'
            # % from 52W high: (price/high52)-1
            gf_52w   = f'=IFERROR(GOOGLEFINANCE("{t}","price")/GOOGLEFINANCE("{t}","high52")-1,"")'
            ad       = analyst_data.get(t, {})

            ext_val = ad.get("ext_pct")   # decimal or None
            rows.append([
                t,                                          # A ticker
                s["company"],                               # B company
                gf_price,                                   # C live price
                gf_pct,                                     # D today %
                ext_val if ext_val is not None else "—",    # E ext hrs %
                gf_52w,                                     # F vs 52W high
                ad.get("rating", "—"),                      # G analyst rating
                ad.get("target", "—"),                      # H price target
                ad.get("technical", "—"),                   # I technical signal
            ])
            stock_row_info.append((current_row, t))
            current_row += 1

        cat_row_ranges.append((cat_hex, cat_r0, current_row))
        rows.append(blank())   # gap between categories
        current_row += 1

    # ── Write to sheet ────────────────────────────────────────────────────────
    ws.update(rows, "A1", value_input_option="USER_ENTERED")

    # ── Batch formatting ──────────────────────────────────────────────────────
    reqs = []

    def rng(r0, r1, c0, c1):
        return {"sheetId": sheet_id, "startRowIndex": r0, "endRowIndex": r1,
                "startColumnIndex": c0, "endColumnIndex": c1}

    def fmt_req(r0, r1, c0, c1, bg=None, bold=False, fg="000000",
                italic=False, size=10, h="LEFT", wrap=False, fmt=None):
        obj = {
            "textFormat": {"bold": bold, "italic": italic, "fontSize": size,
                           "foregroundColor": color(fg)},
            "horizontalAlignment": h,
            "verticalAlignment": "MIDDLE",
        }
        if bg:   obj["backgroundColor"] = color(bg)
        if wrap: obj["wrapStrategy"] = "WRAP"
        if fmt:  obj["numberFormat"] = fmt
        return {"repeatCell": {"range": rng(r0, r1, c0, c1),
                               "cell": {"userEnteredFormat": obj},
                               "fields": "userEnteredFormat"}}

    def merge(r0, r1, c0, c1):
        return {"mergeCells": {"range": rng(r0, r1, c0, c1), "mergeType": "MERGE_ALL"}}

    def dim(dimension, i0, i1, px):
        return {"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": dimension,
                      "startIndex": i0, "endIndex": i1},
            "properties": {"pixelSize": px}, "fields": "pixelSize"}}

    # Dashboard title rows
    reqs += [merge(0,1,0,N_DASH), fmt_req(0,1,0,N_DASH, bg=DARK_BLUE, bold=True,
                                          fg=WHITE, size=14, h="CENTER")]
    reqs += [merge(1,2,0,N_DASH), fmt_req(1,2,0,N_DASH, bg="D9E1F2", italic=True,
                                          fg=DARK_BLUE, size=9, h="CENTER")]
    reqs.append(fmt_req(2,3,0,N_DASH, bg=DARK_BLUE, bold=True, fg=WHITE, size=10, h="CENTER"))
    reqs += [dim("ROWS",0,1,32), dim("ROWS",1,2,18), dim("ROWS",2,3,28)]

    # Category header rows & stock rows
    for cat_hex, cr0, cr1 in cat_row_ranges:
        # Category name row
        reqs += [merge(cr0, cr0+1, 0, N_DASH),
                 fmt_req(cr0, cr0+1, 0, N_DASH, bg=cat_hex, bold=True,
                         fg=WHITE, size=11, h="LEFT")]
        reqs.append(dim("ROWS", cr0, cr0+1, 26))
        # Stock rows in this category
        for i, (sr0, _) in enumerate(
                [(r, t) for r, t in stock_row_info if cr0 < r < cr1]):
            bg = "F2F2F2" if i % 2 == 0 else "FFFFFF"
            reqs.append(fmt_req(sr0, sr0+1, 0, N_DASH, bg=bg, size=10))
            # Ticker bold blue
            reqs.append(fmt_req(sr0, sr0+1, 0, 1, bg=bg, bold=True,
                                fg="0070C0", size=10))
            # % format for Today % (D=3), Ext Hrs % (E=4), vs 52W High (F=5)
            for ci in [3, 4, 5]:
                reqs.append(fmt_req(sr0, sr0+1, ci, ci+1, bg=bg,
                                    fmt={"type":"PERCENT","pattern":"0.00%"}, size=10))
            reqs.append(dim("ROWS", sr0, sr0+1, 22))

    # ── Conditional formats on compact stock rows ──────────────────────────────
    if stock_row_info:
        stock_rows_r0 = stock_row_info[0][0]
        stock_rows_r1 = stock_row_info[-1][0] + 1
        # Today % (D=3) — green
        reqs.append({"addConditionalFormatRule": {"rule": {
            "ranges": [rng(stock_rows_r0, stock_rows_r1, 3, 4)],
            "booleanRule": {
                "condition": {"type": "NUMBER_GREATER", "values": [{"userEnteredValue": "0"}]},
                "format": {"backgroundColor": color("375623"),
                           "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
            }}, "index": 0}})
        # Today % (D=3) — red
        reqs.append({"addConditionalFormatRule": {"rule": {
            "ranges": [rng(stock_rows_r0, stock_rows_r1, 3, 4)],
            "booleanRule": {
                "condition": {"type": "NUMBER_LESS", "values": [{"userEnteredValue": "0"}]},
                "format": {"backgroundColor": color("9C0006"),
                           "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
            }}, "index": 1}})
        # Ext Hrs % (E=4) — green
        reqs.append({"addConditionalFormatRule": {"rule": {
            "ranges": [rng(stock_rows_r0, stock_rows_r1, 4, 5)],
            "booleanRule": {
                "condition": {"type": "NUMBER_GREATER", "values": [{"userEnteredValue": "0"}]},
                "format": {"backgroundColor": color("375623"),
                           "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
            }}, "index": 2}})
        # Ext Hrs % (E=4) — red
        reqs.append({"addConditionalFormatRule": {"rule": {
            "ranges": [rng(stock_rows_r0, stock_rows_r1, 4, 5)],
            "booleanRule": {
                "condition": {"type": "NUMBER_LESS", "values": [{"userEnteredValue": "0"}]},
                "format": {"backgroundColor": color("9C0006"),
                           "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
            }}, "index": 3}})
        # vs 52W High (F=5) — orange when ≤ -20%
        reqs.append({"addConditionalFormatRule": {"rule": {
            "ranges": [rng(stock_rows_r0, stock_rows_r1, 5, 6)],
            "booleanRule": {
                "condition": {"type": "NUMBER_LESS_THAN_EQ",
                              "values": [{"userEnteredValue": "-0.2"}]},
                "format": {"backgroundColor": color(ALERT_ORG),
                           "textFormat": {"bold": True, "foregroundColor": color(WHITE)}},
            }}, "index": 4}})

    # Column widths (dashboard cols)
    for ci, (_, px) in enumerate(DASH_COLS):
        reqs.append(dim("COLUMNS", ci, ci+1, px))

    # Freeze first 3 rows (title + header)
    reqs.append({"updateSheetProperties": {
        "properties": {"sheetId": sheet_id,
                       "gridProperties": {"frozenRowCount": 3}},
        "fields": "gridProperties.frozenRowCount"}})

    # Tab colour — dark blue
    reqs.append({"updateSheetProperties": {
        "properties": {"sheetId": sheet_id, "tabColor": color(DARK_BLUE)},
        "fields": "tabColor"}})

    spreadsheet.batch_update({"requests": reqs})

    # Move dashboard to first position
    spreadsheet.batch_update({"requests": [{"updateSheetProperties": {
        "properties": {"sheetId": sheet_id, "index": 0},
        "fields": "index"}}]})

    n_stocks = len(stock_row_info)
    print(f"  ✓  📊 Dashboard ({n_stocks} stocks, no news — news lives in each category tab)")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    json_str = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not json_str:
        print("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON secret not set.")
        sys.exit(1)
    creds = Credentials.from_service_account_info(json.loads(json_str), scopes=SCOPES)
    gc    = gspread.authorize(creds)

    sheet_url = os.environ.get("GOOGLE_SHEET_URL", "").strip()
    if not sheet_url:
        print("ERROR: GOOGLE_SHEET_URL env var not set.")
        print("Create a blank Google Sheet, share it with the service account,")
        print("then set GOOGLE_SHEET_URL to the sheet's URL.")
        sys.exit(1)

    # Extract sheet ID from URL  (works for /d/<id>/edit and bare IDs)
    import re
    m = re.search(r"/d/([a-zA-Z0-9_-]+)", sheet_url)
    sheet_id_str = m.group(1) if m else sheet_url

    print(f"\nOpening existing Google Sheet ({sheet_id_str[:20]}...)...")
    sh = gc.open_by_key(sheet_id_str)
    # Clear existing worksheets so we start fresh
    existing = sh.worksheets()
    for ws in existing[1:]:   # keep at least one sheet (can't delete all)
        try:
            sh.del_worksheet(ws)
        except Exception:
            pass
    # Rename the first sheet temporarily so our tabs don't clash
    try:
        existing[0].update_title("_temp_")
    except Exception:
        pass

    print("\nFetching analyst & technical data...")
    analyst_data = fetch_analyst_data()

    print("\nBuilding detail watchlist tabs...")
    cat_sheet_ids = {}   # cat name → gid, used for dashboard hyperlinks
    for cat in CATEGORIES:
        if not cat["stocks"]:
            continue
        gid = build_watchlist_sheet(sh, cat, {})
        cat_sheet_ids[cat["name"]] = gid

    print("\nBuilding Dashboard tab...")
    build_dashboard_sheet(sh, analyst_data, cat_sheet_ids)

    # Remove leftover default blank sheet
    for name in ("Sheet1", "_temp_"):
        try:
            sh.del_worksheet(sh.worksheet(name))
        except Exception:
            pass

    print()
    print("=" * 62)
    print("✅  Stock Watchlist updated in Google Sheets!")
    print(f"🔗  {sh.url}")
    print("=" * 62)
    print("• Dashboard: compact view + news feed (first tab)")
    print("• Detail tabs: full metrics, notes, buy-zone alerts")
    print("• Prices auto-refresh every ~20 min via Google Finance")
    print("• Re-run this script anytime to refresh analyst data & news")
    print()


if __name__ == "__main__":
    main()
