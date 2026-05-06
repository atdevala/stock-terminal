
import os
import sys
import json
import textwrap
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials
from gspread_formatting import (
    format_cell_range, CellFormat, Color, TextFormat,
    set_row_height, set_column_width
)

# ── Shared data from the main script ─────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
from generate_financial_tracker import CATEGORIES, fetch_prices

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── Helpers ───────────────────────────────────────────────────────────────────
def hex_to_color(h):
    h = h.lstrip("#")
    return Color(int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255)

def fmt(bg_hex=None, bold=False, fg_hex="000000", size=10, italic=False, wrap=False):
    return CellFormat(
        backgroundColor=hex_to_color(bg_hex) if bg_hex else None,
        textFormat=TextFormat(
            bold=bold, italic=italic,
            fontSize=size,
            foregroundColor=hex_to_color(fg_hex),
        ),
        wrapStrategy="WRAP" if wrap else "OVERFLOW_CELL",
        verticalAlignment="MIDDLE",
    )


def col_a1(n):
    """1-based column index → A1 letter."""
    result = ""
    while n:
        n, r = divmod(n - 1, 26)
        result = chr(65 + r) + result
    return result


def build_category_sheet(spreadsheet, cat, fetched_at):
    stocks = cat["stocks"]
    cat_hex = cat["color"]
    name    = cat["name"]

    try:
        ws = spreadsheet.add_worksheet(title=name, rows=300, cols=20)
    except Exception:
        ws = spreadsheet.worksheet(name)

    COLS = [
        "Ticker", "Company", "Focus / Niche", "Risk",
        "Current Price", "Today's +/- %",
        "Purchase Price", "Shares Owned",
        "Total Cost", "Current Value", "P&L ($)", "P&L (%)",
        "52W High", "52W Low", "% from 52W High",
        "Analyst Target", "Upside to Target", "Price Alert",
    ]
    N = len(COLS)
    last_col = col_a1(N)

    all_values = []

    # Row 1 — category name (will merge + colour below)
    row1 = [name] + [""] * (N - 1)
    all_values.append(row1)

    # Row 2 — description
    row2 = [cat.get("description", "")] + [""] * (N - 1)
    all_values.append(row2)

    # Row 3 — legend
    row3 = [f"Yellow cells = your inputs  |  Prices fetched: {fetched_at}"] + [""] * (N - 1)
    all_values.append(row3)

    # Row 4 — column headers
    all_values.append(COLS)

    first_data = 5  # 1-based
    for stock in stocks:
        lp  = stock.get("live_price", 0)
        dc  = stock.get("daily_change", 0)
        pct = round((dc or 0) * 100, 2)
        row = [
            stock["ticker"],
            stock["company"],
            stock["focus"],
            stock["risk"],
            lp,      # E: current price
            pct,     # F: today % (already ×100)
            0,       # G: purchase price (user fills)
            0,       # H: shares (user fills)
            "",      # I: =G*H  (formula)
            "",      # J: =E*H
            "",      # K: =J-I
            "",      # L: =K/I
            0,       # M: 52W High (user fills)
            0,       # N: 52W Low
            "",      # O: =E/M-1
            0,       # P: analyst target
            "",      # Q: =P/E-1
            "",      # R: alert flag
        ]
        all_values.append(row)

    last_data = first_data + len(stocks) - 1

    # Totals row
    tot_row_idx = last_data + 2  # 1-based
    tot_row_values = ["PORTFOLIO TOTALS"] + [""] * (N - 1)
    # Pad with blank rows between last_data and totals
    while len(all_values) < tot_row_idx - 1:
        all_values.append([""] * N)
    all_values.append(tot_row_values)

    # Notes header row
    notes_start = tot_row_idx + 2
    while len(all_values) < notes_start - 1:
        all_values.append([""] * N)
    all_values.append(["INVESTMENT THESIS & RESEARCH NOTES"] + [""] * (N - 1))

    cur = notes_start  # 1-based, already added header

    WRAP_WIDTH = 55
    for j, stock in enumerate(stocks):
        note_text = stock.get("notes", "")
        cur += 1
        # Label row
        all_values.append(
            [stock["ticker"],
             f"  {stock['company']}   |   Risk: {stock['risk']}"]
            + [""] * (N - 2)
        )
        cur += 1
        # Note text with hard line breaks
        lines = textwrap.wrap(note_text, width=WRAP_WIDTH) if note_text else ["(no notes)"]
        all_values.append(["", "\n".join(lines)] + [""] * (N - 2))
        cur += 1
        # Gap
        all_values.append([""] * N)

    # ── Write all values in one batch ──────────────────────────────────────────
    ws.update(f"A1", all_values, value_input_option="USER_ENTERED")

    # ── Add formulas for data rows ─────────────────────────────────────────────
    formula_updates = []
    for i, stock in enumerate(stocks):
        r = first_data + i
        formula_updates.append({
            "range": f"I{r}:R{r}",
            "values": [[
                f"=G{r}*H{r}",                          # I total cost
                f"=E{r}*H{r}",                          # J current value
                f"=J{r}-I{r}",                          # K P&L $
                f'=IFERROR(K{r}/I{r},"")',               # L P&L %
                f"=M{r}",                               # M (already set, keep)
                f"=N{r}",                               # N
                f'=IFERROR(E{r}/M{r}-1,"")',             # O % from 52W high
                f"=P{r}",                               # P
                f'=IFERROR(P{r}/E{r}-1,"")',             # Q upside
                f'=IF(AND(M{r}>0,E{r}>0,O{r}<-0.2),"▼ BUY ZONE (-20%+ off high)","")',  # R alert
            ]],
        })
    if formula_updates:
        ws.batch_update(formula_updates, value_input_option="USER_ENTERED")

    # ── Formatting via batch requests ─────────────────────────────────────────
    requests = []

    sheet_id = ws._properties["sheetId"]

    def color_obj(h):
        h = h.lstrip("#")
        return {"red": int(h[0:2],16)/255, "green": int(h[2:4],16)/255, "blue": int(h[4:6],16)/255}

    def cell_fmt_req(start_row, end_row, start_col, end_col, bg=None,
                     bold=False, fg="000000", size=10, italic=False,
                     h_align="CENTER", wrap=False):
        fmt_obj = {
            "textFormat": {
                "bold": bold, "italic": italic,
                "fontSize": size,
                "foregroundColor": color_obj(fg),
            },
            "horizontalAlignment": h_align,
            "verticalAlignment": "MIDDLE",
        }
        if bg:
            fmt_obj["backgroundColor"] = color_obj(bg)
        if wrap:
            fmt_obj["wrapStrategy"] = "WRAP"
        return {
            "repeatCell": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": start_row,
                    "endRowIndex": end_row,
                    "startColumnIndex": start_col,
                    "endColumnIndex": end_col,
                },
                "cell": {"userEnteredFormat": fmt_obj},
                "fields": "userEnteredFormat",
            }
        }

    def merge_req(start_row, end_row, start_col, end_col):
        return {
            "mergeCells": {
                "range": {
                    "sheetId": sheet_id,
                    "startRowIndex": start_row,
                    "endRowIndex": end_row,
                    "startColumnIndex": start_col,
                    "endColumnIndex": end_col,
                },
                "mergeType": "MERGE_ALL",
            }
        }

    # Row 1 — category title: merge + colour
    requests += [
        merge_req(0, 1, 0, N),
        cell_fmt_req(0, 1, 0, N, bg=cat_hex, bold=True, fg="FFFFFF", size=14),
    ]
    # Row 2 — description
    requests += [
        merge_req(1, 2, 0, N),
        cell_fmt_req(1, 2, 0, N, bg="D9E1F2", italic=True, fg="1B2A4A", h_align="LEFT"),
    ]
    # Row 3 — legend
    requests += [
        merge_req(2, 3, 0, N),
        cell_fmt_req(2, 3, 0, N, bg="FFFF99", italic=True, fg="7F6000", size=9),
    ]
    # Row 4 — headers
    requests.append(cell_fmt_req(3, 4, 0, N, bg=cat_hex, bold=True, fg="FFFFFF", size=10))

    # Data rows — alternating row colours
    for i in range(len(stocks)):
        r0 = first_data - 1 + i  # 0-based
        bg = "F2F2F2" if i % 2 == 0 else "FFFFFF"
        requests.append(cell_fmt_req(r0, r0+1, 0, N, bg=bg, size=10))
        # Yellow for user-input cols: G(6), H(7), M(12), N(13), P(15)
        for ci in [4, 6, 7, 12, 13, 15]:  # 0-based col indices
            requests.append(cell_fmt_req(r0, r0+1, ci, ci+1, bg="FFFF99", size=10))
        # Today % col (F, index 5) — left as-is (will be coloured by value later)
        # Alert column (R, index 17) — orange conditional styling done inline

    # Totals row
    tr0 = tot_row_idx - 1  # 0-based
    requests += [
        merge_req(tr0, tr0+1, 0, 6),
        cell_fmt_req(tr0, tr0+1, 0, N, bg=cat_hex, bold=True, fg="FFFFFF", size=11),
    ]

    # Notes header
    nh0 = notes_start - 1  # 0-based
    requests += [
        merge_req(nh0, nh0+1, 0, N),
        cell_fmt_req(nh0, nh0+1, 0, N, bg=cat_hex, bold=True, fg="FFFFFF", size=11, h_align="LEFT"),
    ]

    # Notes label rows (light blue) and note rows (wrap text)
    nr0 = nh0 + 1
    for j in range(len(stocks)):
        label_r = nr0 + j * 3
        note_r  = label_r + 1
        bg_note = "F5F5F5" if j % 2 == 0 else "FFFFFF"
        requests += [
            merge_req(label_r, label_r+1, 0, N),
            cell_fmt_req(label_r, label_r+1, 0, N, bg="D9E1F2", bold=True, fg="1B2A4A",
                         size=11, h_align="LEFT"),
            merge_req(note_r, note_r+1, 1, N),
            cell_fmt_req(note_r, note_r+1, 0, 1, bg=bg_note, size=10),
            cell_fmt_req(note_r, note_r+1, 1, N, bg=bg_note, fg="1B2A4A",
                         size=10, h_align="LEFT", wrap=True),
        ]
        # Set note row height tall enough to show full paragraph
        requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": note_r,
                    "endIndex": note_r + 1,
                },
                "properties": {"pixelSize": 200},
                "fields": "pixelSize",
            }
        })

    # Conditional formatting — alert column orange when O < -20%
    requests.append({
        "addConditionalFormatRule": {
            "rule": {
                "ranges": [{
                    "sheetId": sheet_id,
                    "startRowIndex": first_data - 1,
                    "endRowIndex": last_data,
                    "startColumnIndex": 17,
                    "endColumnIndex": 18,
                }],
                "booleanRule": {
                    "condition": {
                        "type": "CUSTOM_FORMULA",
                        "values": [{"userEnteredValue": f"=$O{first_data}<-0.2"}],
                    },
                    "format": {
                        "backgroundColor": color_obj("FF6600"),
                        "textFormat": {"bold": True, "foregroundColor": color_obj("FFFFFF")},
                    },
                },
            },
            "index": 0,
        }
    })
    # Soft orange wash on entire row
    requests.append({
        "addConditionalFormatRule": {
            "rule": {
                "ranges": [{
                    "sheetId": sheet_id,
                    "startRowIndex": first_data - 1,
                    "endRowIndex": last_data,
                    "startColumnIndex": 0,
                    "endColumnIndex": 17,
                }],
                "booleanRule": {
                    "condition": {
                        "type": "CUSTOM_FORMULA",
                        "values": [{"userEnteredValue": f"=$O{first_data}<-0.2"}],
                    },
                    "format": {"backgroundColor": color_obj("FFF0E0")},
                },
            },
            "index": 1,
        }
    })

    # Column widths (pixels ≈ chars × 7)
    col_widths = [70, 150, 160, 75, 80, 75, 80, 70,
                  90, 90, 90, 70, 75, 75, 85, 80, 85, 140]
    for ci, px in enumerate(col_widths[:N]):
        requests.append({
            "updateDimensionProperties": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "COLUMNS",
                    "startIndex": ci,
                    "endIndex": ci + 1,
                },
                "properties": {"pixelSize": px},
                "fields": "pixelSize",
            }
        })

    # Freeze first 4 rows + col A
    requests.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": sheet_id,
                "gridProperties": {"frozenRowCount": 4, "frozenColumnCount": 1},
            },
            "fields": "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
        }
    })

    # Tab colour
    requests.append({
        "updateSheetProperties": {
            "properties": {
                "sheetId": sheet_id,
                "tabColor": color_obj(cat_hex),
            },
            "fields": "tabColor",
        }
    })

    spreadsheet.batch_update({"requests": requests})
    print(f"  ✓ Built tab: {name}")


def main():
    # ── Credentials ───────────────────────────────────────────────────────────
    json_str = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not json_str:
        print("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON secret not set.")
        print("Follow the setup steps above, then re-run this script.")
        sys.exit(1)

    try:
        creds_dict = json.loads(json_str)
    except json.JSONDecodeError:
        print("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.")
        sys.exit(1)

    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    gc    = gspread.authorize(creds)

    # ── Fetch live prices ─────────────────────────────────────────────────────
    print("Fetching live prices...")
    fetched_at = fetch_prices(CATEGORIES)
    fetched_at = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── Create spreadsheet ────────────────────────────────────────────────────
    title = f"Personal Stock Tracker — {datetime.now().strftime('%Y-%m-%d')}"
    print(f"Creating Google Sheet: '{title}'...")
    sh = gc.create(title)

    # Share — anyone with the link can view (change to 'writer' to allow edits)
    sh.share(None, perm_type="anyone", role="writer")

    # ── Build each category tab ───────────────────────────────────────────────
    for cat in CATEGORIES:
        if not cat["stocks"]:
            continue
        build_category_sheet(sh, cat, fetched_at)

    # Delete the default blank sheet
    try:
        sh.del_worksheet(sh.worksheet("Sheet1"))
    except Exception:
        pass

    print()
    print("=" * 60)
    print(f"✅  Google Sheet created!")
    print(f"🔗  URL: {sh.url}")
    print("=" * 60)
    print("Anyone with the link can edit. Share it or bookmark it.")


if __name__ == "__main__":
    main()
