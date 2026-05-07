
"""
Watchlist export to Google Sheets.

- Dashboard tab: compact stock list by category + news feed below
- All price/metric columns use =GOOGLEFINANCE() → auto-updates every ~20 min
- Analyst ratings + technical signals fetched from yfinance on export
- No TradingView API needed — GOOGLEFINANCE covers all the same data
"""

import os, sys, json, textwrap
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytz
import openai
import gspread
from google.oauth2.service_account import Credentials
import yfinance as yf

sys.path.insert(0, os.path.dirname(__file__))
from generate_financial_tracker import CATEGORIES

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── OpenAI client (Replit AI Integrations proxy) ──────────────────────────────
_openai_client = openai.OpenAI(
    base_url=os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL"),
    api_key=os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY", "dummy"),
)
_EST = pytz.timezone("US/Eastern")

def _est_time(pub_ts):
    """Convert a pubDate string or unix timestamp to 'Mon DD HH:MM EST'."""
    try:
        if isinstance(pub_ts, str):
            dt = datetime.fromisoformat(pub_ts.replace("Z", "+00:00"))
        elif isinstance(pub_ts, (int, float)):
            dt = datetime.fromtimestamp(pub_ts, tz=timezone.utc)
        else:
            return ""
        return dt.astimezone(_EST).strftime("%b %d %I:%M %p EST")
    except Exception:
        return ""

def _strip_html(html):
    """Remove HTML tags and collapse whitespace."""
    import re
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()

def _ai_analysis(ticker, headline, summary=""):
    """Return a 1-2 sentence bullish/bearish/neutral assessment via OpenAI.
    Uses the full article summary for richer context when available."""
    try:
        body = f'Headline: "{headline}"'
        if summary:
            body += f"\nArticle content: {summary}"
        resp = _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            max_completion_tokens=130,
            messages=[{"role": "user", "content": (
                f"You are a stock analyst. Analyze this news article about ${ticker}.\n"
                f"{body}\n\n"
                f"In 1-2 sentences, state whether this is Bullish, Bearish, or Neutral "
                f"for ${ticker} and explain the specific reason based on the article content.\n"
                f"Start with 🟢 Bullish, 🔴 Bearish, or 🟡 Neutral —"
            )}],
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return f"(AI error: {e})"

# ── Palette ───────────────────────────────────────────────────────────────────
WHITE      = "FFFFFF"
DARK_BLUE  = "1B2A4A"
YELLOW_IN  = "FFF2CC"   # user-editable cells
ALERT_ORG  = "FF6600"

def color(h):
    h = h.lstrip("#")
    return {"red": int(h[0:2],16)/255, "green": int(h[2:4],16)/255, "blue": int(h[4:6],16)/255}

_STOP_WORDS = {"inc", "corp", "corporation", "ltd", "llc", "co", "group",
               "holdings", "the", "and", "of", "usa", "us", "company"}

def _is_relevant(headline, summary, ticker, company):
    """Return True if this article is meaningfully about the given ticker."""
    import re
    text = (headline + " " + (summary or "")).lower()
    # 1. Exact ticker match (word boundary)
    if re.search(r'\b' + re.escape(ticker.lower()) + r'\b', text):
        return True
    # 2. Ticker in parentheses — common in financial news e.g. (NVDA)
    if f"({ticker.upper()})" in (headline + " " + (summary or "")):
        return True
    # 3. Significant words from the company name
    words = re.split(r'\W+', company.lower())
    sig = [w for w in words if w not in _STOP_WORDS and len(w) > 3]
    for word in sig:
        if re.search(r'\b' + re.escape(word) + r'\b', text):
            return True
    return False

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
    ("Ticker",               72,  False),   # A — static text
    ("Company",              165, False),   # B — static text
    ("Focus / Niche",        165, False),   # C — static text
    ("Risk",                 78,  False),   # D — static text
    ("Live Price",           88,  False),   # E — GOOGLEFINANCE
    ("Today's %",            82,  False),   # F — GOOGLEFINANCE
    ("1-Week %",             82,  False),   # G — GOOGLEFINANCE (QUERY)
    ("1-Month %",            88,  False),   # H — GOOGLEFINANCE (QUERY)
    ("3-Month %",            88,  False),   # I — GOOGLEFINANCE (QUERY)
    ("YTD %",                130, False),   # J — GOOGLEFINANCE (QUERY)
    ("52W High",             88,  False),   # K — GOOGLEFINANCE
    ("52W Low",              88,  False),   # L — GOOGLEFINANCE
    ("% from 52W High",      108, False),   # M — formula
    ("P/E Ratio",            78,  False),   # N — GOOGLEFINANCE
    ("Market Cap",           108, False),   # O — GOOGLEFINANCE
    ("Volume",               98,  False),   # P — GOOGLEFINANCE
    ("Analyst Target",       98,  True),    # Q — user input (yellow)
    ("Upside to Target",     98,  False),   # R — formula
    ("Price Alert",          195, False),   # S — formula (buy zone flag — needs room)
]
N_COLS = len(WATCH_COLS)


def gf(ticker, attr):
    """Return a GOOGLEFINANCE formula string."""
    return f'=GOOGLEFINANCE("{ticker}","{attr}")'


def fetch_historical_returns():
    """
    Fetch 1W, 1M, 3M, and YTD returns for all tickers via yfinance.
    Returns dict: {ticker: {"w1": float|None, "m1": float|None, "m3": float|None, "ytd": float|None}}

    Why: GOOGLEFINANCE historical date-range queries are unreliable and frequently return blank
    cells via IFERROR. Fetching directly from yfinance guarantees consistent, always-visible values.
    """
    all_tickers = [s["ticker"] for cat in CATEGORIES for s in cat["stocks"]]

    def _fetch_one(t):
        try:
            hist = yf.Ticker(t).history(period="1y", auto_adjust=True)
            if hist.empty:
                return t, {}
            closes = hist["Close"].dropna()
            if closes.empty:
                return t, {}
            current = float(closes.iloc[-1])

            def pct(n):
                if len(closes) > n:
                    return round(current / float(closes.iloc[-n - 1]) - 1, 6)
                return None

            # YTD: first close of this calendar year
            this_year = datetime.now().year
            yr = closes[closes.index.year == this_year]
            ytd = round(current / float(yr.iloc[0]) - 1, 6) if not yr.empty else None

            return t, {"w1": pct(5), "m1": pct(21), "m3": pct(63), "ytd": ytd}
        except Exception:
            return t, {}

    result = {}
    print("  Fetching historical returns (1W/1M/3M/YTD) via yfinance...")
    with ThreadPoolExecutor(max_workers=10) as ex:
        for ticker, data in ex.map(_fetch_one, all_tickers):
            result[ticker] = data
    ok = sum(1 for v in result.values() if v.get("m1") is not None)
    print(f"  ✓  Historical returns: {ok}/{len(result)} tickers")
    return result


def build_watchlist_sheet(spreadsheet, cat, sheet_id_map, hist_data=None, analyst_data=None):
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
    hist_data    = hist_data    or {}
    analyst_data = analyst_data or {}
    for stock in stocks:
        t  = stock["ticker"]
        h  = hist_data.get(t, {})
        ad = analyst_data.get(t, {})
        # Historical % returns — yfinance direct (no GOOGLEFINANCE flakiness)
        w1  = h.get("w1");  m1 = h.get("m1");  m3 = h.get("m3");  ytd = h.get("ytd")
        # Fundamental & market data — yfinance direct
        high52    = ad.get("high52")
        low52     = ad.get("low52")
        vs52      = ad.get("vs52")
        pe        = ad.get("pe")
        marketcap = ad.get("marketcap")
        volume    = ad.get("volume")
        # BUY ZONE computed directly — no formula dependency
        buy_zone = ("▼  BUY ZONE  (-20%+ off 52W high)"
                    if vs52 is not None and vs52 < -0.2 else "—")
        r_row = first_data + len(all_values) - 4   # 1-based row for upside formula (Q/E)
        row = [
            t,                                              # A ticker
            stock["company"],                               # B company
            stock["focus"],                                 # C focus
            stock["risk"],                                  # D risk
            gf(t, "price"),                                 # E live price (single reliable GOOGLEFINANCE call)
            f'=IFERROR(GOOGLEFINANCE("{t}","changepct")/100,"")',  # F today %
            w1  if w1  is not None else "—",                # G 1-Week  (yfinance)
            m1  if m1  is not None else "—",                # H 1-Month (yfinance)
            m3  if m3  is not None else "—",                # I 3-Month (yfinance)
            ytd if ytd is not None else "—",                # J YTD    (yfinance)
            high52    if high52    is not None else "—",    # K 52W High  (yfinance)
            low52     if low52     is not None else "—",    # L 52W Low   (yfinance)
            vs52      if vs52      is not None else "—",    # M % from 52W Hi (yfinance)
            pe        if pe        is not None else "—",    # N P/E       (yfinance)
            marketcap if marketcap is not None else "—",    # O Market Cap (yfinance)
            volume    if volume    is not None else "—",    # P Volume    (yfinance)
            "",                                             # Q analyst target (user fills)
            f'=IFERROR(Q{r_row}/E{r_row}-1,"")',            # R upside vs user target
            buy_zone,                                       # S BUY ZONE alert (yfinance)
        ]
        all_values.append(row)

    last_data = first_data + len(stocks) - 1

    # Notes section
    notes_start = last_data + 3
    while len(all_values) < notes_start - 1:
        all_values.append([""] * N_COLS)
    all_values.append(["INVESTMENT THESIS & RESEARCH NOTES"] + [""] * (N_COLS - 1))

    # Notes rows — write raw text (no textwrap); Google Sheets wraps visually.
    # Merged cell is ~1877px wide; at 10pt ~250 chars/line → longest note ~4 lines.
    # 120px height is enough for 5 lines + padding, no clipping.
    NOTES_ROW_PX = 120
    nr_idx = notes_start  # 1-based row of next notes row to add
    for j, stock in enumerate(stocks):
        note_text = stock.get("notes", "") or "(no notes)"
        all_values.append(
            [stock["ticker"],
             f"  {stock['company']}   |   Risk: {stock['risk']}"]
            + [""] * (N_COLS - 2)
        )
        nr_idx += 1
        all_values.append(["", note_text] + [""] * (N_COLS - 2))
        nr_idx += 1
        all_values.append([""] * N_COLS)   # gap
        nr_idx += 1

    # ── News Feed section (below notes) ───────────────────────────────────────
    # Cols: A=Ticker | B=Company | C-I=Headline(linked) | J=Time(EST) | K-S=AI Analysis
    news_section_r0 = len(all_values)   # 0-based
    all_values.append(["📰  LATEST NEWS"] + [""] * (N_COLS - 1))
    news_hdr = [""] * N_COLS
    news_hdr[0] = "Ticker"; news_hdr[1] = "Company"
    news_hdr[2] = "Headline (click to open)"; news_hdr[9] = "Published (EST)"
    news_hdr[10] = "🤖 AI Impact Analysis"
    all_values.append(news_hdr)

    # ── Step 1: collect raw news items ────────────────────────────────────────
    alt = 0
    ticker_alt = {}
    raw_news = []   # list of dicts or None (gap marker)
    for stock in stocks:
        t = stock["ticker"]
        if t not in ticker_alt:
            ticker_alt[t] = alt
            alt = 1 - alt
        try:
            # Fetch up to 20 articles so we have a large pool to filter
            items = yf.Ticker(t).get_news(count=20) or []
            if not items:
                raw_news.append({"ticker": t, "company": stock["company"],
                                 "headline": "(no recent news)", "url": None, "est": ""})
                continue
            relevant = []
            for item in items:
                content  = item.get("content", {})
                headline = content.get("title") or item.get("title", "No title")
                summary  = content.get("summary", "")
                if not _is_relevant(headline, summary, t, stock["company"]):
                    continue
                pub_ts  = content.get("pubDate") or item.get("providerPublishTime")
                url_obj = content.get("canonicalUrl")
                url     = url_obj.get("url") if isinstance(url_obj, dict) else None
                # Prefer plain summary; fall back to HTML description stripped of tags
                article_text = summary or _strip_html(content.get("description", ""))
                # Normalise timestamp for sorting
                try:
                    if isinstance(pub_ts, str):
                        ts_sort = datetime.fromisoformat(
                            pub_ts.replace("Z", "+00:00")).timestamp()
                    elif isinstance(pub_ts, (int, float)):
                        ts_sort = float(pub_ts)
                    else:
                        ts_sort = 0.0
                except Exception:
                    ts_sort = 0.0
                relevant.append({"ticker": t, "company": stock["company"],
                                 "headline": headline, "url": url,
                                 "summary": article_text,
                                 "est": _est_time(pub_ts), "ts_sort": ts_sort})
            if not relevant:
                raw_news.append({"ticker": t, "company": stock["company"],
                                 "headline": "(no relevant news found)", "url": None, "est": ""})
            else:
                # Most-recent first
                relevant.sort(key=lambda x: x["ts_sort"], reverse=True)
                for entry in relevant[:4]:
                    raw_news.append(entry)
        except Exception as e:
            raw_news.append({"ticker": t, "company": stock["company"],
                             "headline": f"(error fetching news: {e})",
                             "url": None, "est": ""})
        raw_news.append(None)   # gap between stocks

    # ── Step 2: AI analysis — run concurrently ────────────────────────────────
    print("  Running AI impact analysis on news articles (concurrent)...")
    analysable = [(i, n) for i, n in enumerate(raw_news)
                  if n is not None and not n["headline"].startswith("(")]

    analyses = {}
    def _analyse(args):
        i, n = args
        return i, _ai_analysis(n["ticker"], n["headline"], n.get("summary", ""))

    with ThreadPoolExecutor(max_workers=10) as ex:
        for i, result in ex.map(_analyse, analysable):
            analyses[i] = result
    print(f"  ✓  AI analysis: {len(analyses)} articles processed")

    # ── Step 3: build rows ────────────────────────────────────────────────────
    news_row_info = []   # (0-based index, ticker) for formatting
    for i, n in enumerate(raw_news):
        if n is None:
            all_values.append([""] * N_COLS)
            continue
        idx = len(all_values)
        row = [""] * N_COLS
        row[0] = n["ticker"]
        row[1] = n["company"]
        if n["url"] and not n["headline"].startswith("("):
            esc = n["headline"].replace('"', '""')
            row[2] = f'=HYPERLINK("{n["url"]}","{esc}")'
        else:
            row[2] = n["headline"]
        row[9]  = n["est"]
        row[10] = analyses.get(i, "")
        all_values.append(row)
        news_row_info.append((idx, n["ticker"]))

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
        # Wrap + left-align Company (B=1) and Focus/Niche (C=2) so text shows fully
        reqs.append(fmt_req(r0, r0+1, 1, 3, bg=bg, size=10, h="LEFT", wrap=True))
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
        # Row height — 36px fits 2 lines of wrapped text comfortably
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS",
                      "startIndex": r0, "endIndex": r0+1},
            "properties": {"pixelSize": 36}, "fields": "pixelSize"}})

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
            "properties": {"pixelSize": NOTES_ROW_PX}, "fields": "pixelSize"}})

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
    # Merge header cells to match data row layout
    reqs.append(merge(news_col_h, news_col_h+1, 2, 9))   # Headline header C-I
    reqs.append(fmt_req(news_col_h, news_col_h+1, 2, 9,
                        bg=DARK_BLUE, bold=True, fg=WHITE, size=10, h="CENTER"))
    reqs.append(merge(news_col_h, news_col_h+1, 10, N_COLS))  # AI header K-S
    reqs.append(fmt_req(news_col_h, news_col_h+1, 10, N_COLS,
                        bg=DARK_BLUE, bold=True, fg=WHITE, size=10, h="CENTER"))
    reqs.append({"updateDimensionProperties": {
        "range": {"sheetId": sheet_id, "dimension": "ROWS",
                  "startIndex": news_col_h, "endIndex": news_col_h+1},
        "properties": {"pixelSize": 28}, "fields": "pixelSize"}})

    for nr0, t in news_row_info:
        bg = "EBF3FB" if ticker_alt.get(t, 0) == 0 else "FFFFFF"
        reqs.append(fmt_req(nr0, nr0+1, 0, N_COLS, bg=bg, size=10))
        # Ticker (A=0) bold blue
        reqs.append(fmt_req(nr0, nr0+1, 0, 1, bg=bg, bold=True, fg="0070C0", size=10))
        # Company (B=1) left-aligned
        reqs.append(fmt_req(nr0, nr0+1, 1, 2, bg=bg, size=10, h="LEFT"))
        # Headline: merge C-I (cols 2-8), blue hyperlink colour, wrap
        reqs.append(merge(nr0, nr0+1, 2, 9))
        reqs.append(fmt_req(nr0, nr0+1, 2, 9, bg=bg, size=10, wrap=True,
                            h="LEFT", fg="1155CC"))
        # Published EST (J=9) centred, small grey italic
        reqs.append(fmt_req(nr0, nr0+1, 9, 10, bg=bg, size=9, h="CENTER",
                            fg="666666", italic=True))
        # AI Analysis: merge K-S (cols 10-18), dark text, wrap
        reqs.append(merge(nr0, nr0+1, 10, N_COLS))
        reqs.append(fmt_req(nr0, nr0+1, 10, N_COLS, bg=bg, size=9, wrap=True,
                            h="LEFT", fg="1A1A2E"))
        # Row height — 60px fits 2-line headline + 2-line AI analysis
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": sheet_id, "dimension": "ROWS",
                      "startIndex": nr0, "endIndex": nr0+1},
            "properties": {"pixelSize": 60}, "fields": "pixelSize"}})

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

            high52     = info.get("fiftyTwoWeekHigh")
            low52      = info.get("fiftyTwoWeekLow")
            chg_pct    = info.get("regularMarketChangePercent")  # e.g. 5.68 for +5.68%
            pe         = info.get("trailingPE")
            marketcap  = info.get("marketCap")
            volume     = info.get("volume") or info.get("averageVolume")

            # vs 52W High as decimal (e.g. -0.04 for -4%)
            vs52 = None
            if price and high52 and high52 > 0:
                vs52 = round((price / high52) - 1, 6)

            result[t] = {
                "rating":    rating,
                "target":    f"${target:,.2f}" if target else "—",
                "technical": tech,
                "ext_pct":   ext_pct,       # None → "—" when writing
                "price":     price,          # numeric, None if unavailable
                "chg_pct":   chg_pct / 100 if chg_pct is not None else None,  # decimal
                "vs52":      vs52,           # decimal, None if unavailable
                "high52":    high52,         # raw number, None if unavailable
                "low52":     low52,
                "pe":        round(pe, 2) if pe else None,
                "marketcap": marketcap,
                "volume":    volume,
            }
        except Exception:
            result[t] = {"rating": "—", "target": "—", "technical": "—",
                         "ext_pct": None, "price": None, "chg_pct": None, "vs52": None,
                         "high52": None, "low52": None, "pe": None,
                         "marketcap": None, "volume": None}

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
    rows.append([f"Prices & % change as of last script run: {now_str}  |  Re-run script to refresh  |  Category tabs have live GOOGLEFINANCE auto-refresh"]
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
            ad = analyst_data.get(t, {})

            # Use direct yfinance values — no GOOGLEFINANCE formulas on Dashboard
            # so prices always show instantly without "Loading..." delays.
            price_val = ad.get("price")
            chg_val   = ad.get("chg_pct")
            vs52_val  = ad.get("vs52")
            ext_val   = ad.get("ext_pct")

            rows.append([
                t,                                                   # A ticker
                s["company"],                                        # B company
                price_val if price_val is not None else "—",         # C live price
                chg_val   if chg_val   is not None else "—",         # D today %
                ext_val   if ext_val   is not None else "—",         # E ext hrs %
                vs52_val  if vs52_val  is not None else "—",         # F vs 52W high
                ad.get("rating", "—"),                               # G analyst rating
                ad.get("target", "—"),                               # H price target
                ad.get("technical", "—"),                            # I technical signal
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

    DASH_CAT_COLOR = "D9E1F2"   # same light blue as subtitle row (A2:I2)

    # Category header rows & stock rows
    for cat_hex, cr0, cr1 in cat_row_ranges:
        # Category name row
        reqs += [merge(cr0, cr0+1, 0, N_DASH),
                 fmt_req(cr0, cr0+1, 0, N_DASH, bg=DASH_CAT_COLOR, bold=True,
                         fg=DARK_BLUE, size=11, h="LEFT")]
        reqs.append(dim("ROWS", cr0, cr0+1, 26))
        # Stock rows in this category
        for i, (sr0, _) in enumerate(
                [(r, t) for r, t in stock_row_info if cr0 < r < cr1]):
            bg = "F2F2F2" if i % 2 == 0 else "FFFFFF"
            reqs.append(fmt_req(sr0, sr0+1, 0, N_DASH, bg=bg, size=10))
            # Ticker bold blue
            reqs.append(fmt_req(sr0, sr0+1, 0, 1, bg=bg, bold=True,
                                fg="0070C0", size=10))
            # Currency for Live Price (C=2)
            reqs.append(fmt_req(sr0, sr0+1, 2, 3, bg=bg,
                                fmt={"type":"CURRENCY","pattern":'"$"#,##0.00'}, size=10))
            # % format for Today % (D=3), Ext Hrs % (E=4), vs 52W High (F=5)
            for ci in [3, 4, 5]:
                reqs.append(fmt_req(sr0, sr0+1, ci, ci+1, bg=bg,
                                    fmt={"type":"PERCENT","pattern":"0.00%"}, size=10))
            reqs.append(dim("ROWS", sr0, sr0+1, 24))

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

    hist_data = fetch_historical_returns()

    print("\nBuilding detail watchlist tabs...")
    cat_sheet_ids = {}   # cat name → gid, used for dashboard hyperlinks
    for cat in CATEGORIES:
        if not cat["stocks"]:
            continue
        gid = build_watchlist_sheet(sh, cat, {}, hist_data=hist_data, analyst_data=analyst_data)
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
