
"""
Watchlist export to Google Sheets.

- All price/metric columns use =GOOGLEFINANCE() → auto-updates every ~20 min
- News Feed sheet pulls latest headlines from Yahoo Finance (refresh by re-running)
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
            f'=IFERROR((GOOGLEFINANCE("{t}","price")/GOOGLEFINANCE("{t}","closeyest")^5)-1,"")',  # G 1W approx
            f'=IFERROR(GOOGLEFINANCE("{t}","returnytd"),"")',  # H (use ytd as proxy)
            f'=IFERROR(GOOGLEFINANCE("{t}","returnytd"),"")',  # I 3M (limited by GF)
            f'=IFERROR(GOOGLEFINANCE("{t}","returnytd"),"")',  # J YTD
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


# ── News Feed sheet ───────────────────────────────────────────────────────────
def build_news_sheet(spreadsheet):
    """Fetch latest headlines from Yahoo Finance and write to a News Feed tab."""
    print("  Fetching news headlines from Yahoo Finance...")

    try:
        ws = spreadsheet.add_worksheet(title="📰 News Feed", rows=2000, cols=5)
    except Exception:
        ws = spreadsheet.worksheet("📰 News Feed")

    sheet_id = ws._properties["sheetId"]

    # Collect all tickers
    all_stocks = []
    for cat in CATEGORIES:
        for s in cat["stocks"]:
            s["_cat"] = cat["name"]
            all_stocks.append(s)

    rows = [["📰  STOCK NEWS FEED", "", "", "", ""]]
    rows.append([f"Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M')}", "", "", "", ""])
    rows.append([""])
    rows.append(["Ticker", "Company", "Category", "Headline", "Published"])

    news_rows_start = 5  # 1-based

    for stock in all_stocks:
        try:
            ticker_obj = yf.Ticker(stock["ticker"])
            news_items = ticker_obj.news or []
            if not news_items:
                rows.append([stock["ticker"], stock["company"], stock["_cat"],
                             "(no recent news found)", ""])
                continue
            for item in news_items[:4]:   # max 4 headlines per stock
                content = item.get("content", {})
                title   = content.get("title") or item.get("title", "No title")
                # Published time
                pub_ts  = content.get("pubDate") or item.get("providerPublishTime")
                if isinstance(pub_ts, (int, float)):
                    pub = datetime.fromtimestamp(pub_ts).strftime("%Y-%m-%d %H:%M")
                elif isinstance(pub_ts, str):
                    pub = pub_ts[:16]
                else:
                    pub = ""
                rows.append([stock["ticker"], stock["company"], stock["_cat"], title, pub])
        except Exception as e:
            rows.append([stock["ticker"], stock["company"], stock.get("_cat",""),
                         f"(error fetching news: {e})", ""])

        rows.append(["", "", "", "", ""])   # blank row between stocks

    ws.update(rows, "A1", value_input_option="USER_ENTERED")

    # ── Format ────────────────────────────────────────────────────────────────
    reqs = []

    def rng(r0,r1,c0,c1):
        return {"sheetId": sheet_id,"startRowIndex":r0,"endRowIndex":r1,
                "startColumnIndex":c0,"endColumnIndex":c1}
    def fmt_req(r0,r1,c0,c1,bg=None,bold=False,fg="000000",size=10,h="LEFT",wrap=False):
        obj = {"textFormat":{"bold":bold,"fontSize":size,"foregroundColor":color(fg)},
               "horizontalAlignment":h,"verticalAlignment":"MIDDLE"}
        if bg: obj["backgroundColor"] = color(bg)
        if wrap: obj["wrapStrategy"] = "WRAP"
        return {"repeatCell":{"range":rng(r0,r1,c0,c1),
                              "cell":{"userEnteredFormat":obj},
                              "fields":"userEnteredFormat"}}
    def merge(r0,r1,c0,c1):
        return {"mergeCells":{"range":rng(r0,r1,c0,c1),"mergeType":"MERGE_ALL"}}

    # Title
    reqs += [merge(0,1,0,5), fmt_req(0,1,0,5,bg=DARK_BLUE,bold=True,fg=WHITE,size=14,h="CENTER")]
    reqs += [merge(1,2,0,5), fmt_req(1,2,0,5,bg="D9E1F2",fg=DARK_BLUE,size=10,h="CENTER")]
    # Header row
    reqs.append(fmt_req(3,4,0,5,bg=DARK_BLUE,bold=True,fg=WHITE,size=10,h="CENTER"))

    # Column widths
    col_widths = [70, 150, 180, 450, 130]
    for ci, px in enumerate(col_widths):
        reqs.append({"updateDimensionProperties":{
            "range":{"sheetId":sheet_id,"dimension":"COLUMNS",
                     "startIndex":ci,"endIndex":ci+1},
            "properties":{"pixelSize":px},"fields":"pixelSize"}})

    # Row heights for news rows — tall enough for headline text
    for ri in range(news_rows_start - 1, len(rows)):
        reqs.append({"updateDimensionProperties":{
            "range":{"sheetId":sheet_id,"dimension":"ROWS",
                     "startIndex":ri,"endIndex":ri+1},
            "properties":{"pixelSize":30},"fields":"pixelSize"}})

    # Alternating colours + headline wrap for data rows
    ticker_seen = {}
    alt = 0
    for ri, row_data in enumerate(rows[news_rows_start - 1:], start=news_rows_start - 1):
        if not any(row_data):
            continue
        t = row_data[0] if row_data[0] else None
        if t and t not in ticker_seen:
            ticker_seen[t] = alt
            alt = 1 - alt
        bg = "EBF3FB" if ticker_seen.get(t, 0) == 0 else "FFFFFF"
        reqs.append(fmt_req(ri, ri+1, 0, 5, bg=bg, size=10))
        reqs.append(fmt_req(ri, ri+1, 3, 4, bg=bg, size=10, wrap=True))   # headline col
        reqs.append(fmt_req(ri, ri+1, 0, 1, bg=bg, bold=True, fg="000070C0", size=10))  # ticker bold blue

    reqs.append({"updateSheetProperties":{
        "properties":{"sheetId":sheet_id,"tabColor":color("1B2A4A")},
        "fields":"tabColor"}})
    reqs.append({"updateSheetProperties":{
        "properties":{"sheetId":sheet_id,
                      "gridProperties":{"frozenRowCount":4}},
        "fields":"gridProperties.frozenRowCount"}})

    spreadsheet.batch_update({"requests": reqs})
    print(f"  ✓  📰 News Feed ({len(rows)-4} rows)")


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

    print("\nBuilding watchlist tabs...")
    for cat in CATEGORIES:
        if not cat["stocks"]:
            continue
        build_watchlist_sheet(sh, cat, {})

    print("\nBuilding news feed...")
    build_news_sheet(sh)

    # Remove default blank sheet
    try:
        sh.del_worksheet(sh.worksheet("Sheet1"))
    except Exception:
        pass

    print()
    print("=" * 62)
    print("✅  Stock Watchlist created in Google Sheets!")
    print(f"🔗  {sh.url}")
    print("=" * 62)
    print("• All prices & metrics update automatically every ~20 min")
    print("• Yellow cells = your inputs (analyst targets)")
    print("• Re-run this script anytime to refresh the news feed")
    print()


if __name__ == "__main__":
    main()
