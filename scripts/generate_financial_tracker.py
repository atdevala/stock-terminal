
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule
from openpyxl.chart import BarChart, Reference
import yfinance as yf
from datetime import datetime

# ── Palette ──────────────────────────────────────────────────────────────────
DARK_BLUE   = "1B2A4A"
MID_BLUE    = "2F5496"
LIGHT_BLUE  = "BDD7EE"
YELLOW_IN   = "FFF2CC"   # input cells
WHITE       = "FFFFFF"
LIGHT_GRAY  = "F5F5F5"
GREEN_BG    = "E2EFDA"
RED_BG      = "FFC7CE"
GREEN_FONT  = "375623"
RED_FONT    = "9C0006"

def side(style="thin"):
    return Side(border_style=style, color="AAAAAA")

THIN_BORDER = Border(left=side(), right=side(), top=side(), bottom=side())

def hdr_border():
    return Border(left=side(), right=side(), top=side("medium"), bottom=side("medium"))

def fill(hex_color):
    return PatternFill(start_color=hex_color, end_color=hex_color, fill_type="solid")

def font(bold=False, color=WHITE, size=11, italic=False):
    return Font(bold=bold, color=color, size=size, italic=italic, name="Calibri")

def center():
    return Alignment(horizontal="center", vertical="center", wrap_text=True)

def left():
    return Alignment(horizontal="left", vertical="center", wrap_text=True)

# ── Category definitions ──────────────────────────────────────────────────────
CATEGORIES = [
    {
        "name": "📊 Dashboard",
        "tab_color": "1B2A4A",
        "color": "1B2A4A",
        "description": "",
        "stocks": [],
    },
    {
        "name": "⚛️ Quantum Computing",
        "tab_color": "7030A0",
        "color": "7030A0",
        "description": "High-risk quantum plays — potential 10× returns within 2 years",
        "stocks": [
            {"ticker": "IONQ",  "company": "IonQ Inc",          "focus": "Quantum computing hardware & software",   "risk": "Very High", "notes": "Next quantum run candidate. Easy 10× within 2 years potential."},
            {"ticker": "RGTI",  "company": "Rigetti Computing",  "focus": "Quantum computing chips & systems",        "risk": "Very High", "notes": "Next quantum run candidate. Easy 10× within 2 years potential."},
            {"ticker": "QBTS",  "company": "D-Wave Quantum",     "focus": "Quantum annealing systems",               "risk": "Very High", "notes": "Next quantum run candidate. Easy 10× within 2 years potential."},
        ],
    },
    {
        "name": "🖥️ Semiconductors & Compute",
        "tab_color": "0070C0",
        "color": "0070C0",
        "description": "Core semiconductor & compute names — stability + steady compounders",
        "stocks": [
            {"ticker": "NVDA",  "company": "NVIDIA Corp",              "focus": "GPUs, AI compute",              "risk": "Medium",      "notes": "The AI compute king. Stability and steady compounder."},
            {"ticker": "AVGO",  "company": "Broadcom Inc",             "focus": "Semiconductors, networking",    "risk": "Medium",      "notes": "Stability and steady compounder."},
            {"ticker": "LRCX",  "company": "Lam Research",             "focus": "Semiconductor equipment, DRAM", "risk": "Medium",      "notes": "Stability and steady compounder. DRAM equipment leader."},
            {"ticker": "AMD",   "company": "Advanced Micro Devices",   "focus": "CPUs, GPUs, AI chips",          "risk": "Medium",      "notes": "CPU maker deep in the AI infrastructure stack."},
            {"ticker": "INTC",  "company": "Intel Corp",               "focus": "CPUs, AI accelerators",         "risk": "Med-High",    "notes": "CPU maker in AI infrastructure stack. Turnaround story."},
            {"ticker": "ARM",   "company": "Arm Holdings",             "focus": "Chip architecture licensing",   "risk": "Medium",      "notes": "Architecture behind most AI edge chips. Royalty model."},
        ],
    },
    {
        "name": "⚙️ AI Picks & Shovels",
        "tab_color": "C55A11",
        "color": "C55A11",
        "description": "Smaller-cap NVDA-adjacent setups — high risk, asymmetric upside",
        "stocks": [
            {"ticker": "NVTS",  "company": "Navitas Semiconductor",  "focus": "GaN power chips for AI data centers",             "risk": "High",      "notes": "AI data centers need radically more efficient power delivery. Picks-and-shovels for compute growth."},
            {"ticker": "AEHR",  "company": "AEHR Test Systems",       "focus": "Semiconductor burn-in & test equipment",          "risk": "High",      "notes": "Classic shovels in a gold rush. More AI chips = more testing bottleneck demand."},
            {"ticker": "CRDO",  "company": "Credo Technology",        "focus": "High-speed connectivity / SerDes for AI DCs",     "risk": "High",      "notes": "GPUs don't matter if data can't move between them. Cleanest AI infrastructure picks-and-shovels name."},
            {"ticker": "ALGM",  "company": "Allegro MicroSystems",    "focus": "Power & sensing semiconductors",                  "risk": "Med-High",  "notes": "Electrification + AI hardware power efficiency. Quiet compounder, early in AI rerating narrative."},
            {"ticker": "HIMX",  "company": "Himax Technologies",      "focus": "Display drivers + AR/AI vision chips",            "risk": "High",      "notes": "Exposure to AI edge devices + optics. Higher volatility, historically rerates fast on cycles."},
            {"ticker": "MTSI",  "company": "MACOM Technology",        "focus": "RF, microwave, high-speed analog chips",          "risk": "Med-High",  "notes": "AI datacenter interconnect + telecom backbone. Less hype, more industrial AI backbone exposure."},
            {"ticker": "AEVA",  "company": "Aeva Technologies",       "focus": "Lidar + sensing for autonomous systems",          "risk": "Very High", "notes": "Autonomous systems + robotics long tail. Pure asymmetric bet: low probability, high upside."},
        ],
    },
    {
        "name": "💡 Photonics & Optics",
        "tab_color": "00B0F0",
        "color": "00B0F0",
        "description": "Optical networking — key bottleneck in AI data center interconnect",
        "stocks": [
            {"ticker": "LITE",  "company": "Lumentum Holdings",  "focus": "Photonics, optical components for AI DCs",  "risk": "High",  "notes": "King of Photonics. Could moonshot. Key bottleneck in AI data movement. Critical infrastructure."},
        ],
    },
    {
        "name": "🏗️ DC Builders & Cooling",
        "tab_color": "375623",
        "color": "375623",
        "description": "Builders, materials, and cooling companies powering AI data center construction",
        "stocks": [
            {"ticker": "CAT",   "company": "Caterpillar Inc",       "focus": "Heavy equipment, construction",            "risk": "Low-Med",   "notes": "Actual builder and materials company in the AI data center trade."},
            {"ticker": "FIX",   "company": "Comfort Systems USA",   "focus": "HVAC, mechanical, electrical for DCs",    "risk": "Medium",    "notes": "Builder AND cooling company. AI data center HVAC & MEP systems. Major growing bottleneck."},
            {"ticker": "POWL",  "company": "Powell Industries",     "focus": "Electrical infrastructure for DCs",       "risk": "Medium",    "notes": "Electrical infrastructure builder for AI data centers."},
            {"ticker": "VRT",   "company": "Vertiv Holdings",       "focus": "Cooling systems for AI data centers",     "risk": "Medium",    "notes": "Premier AI data center cooling play. Cooling is a growing bottleneck."},
        ],
    },
    {
        "name": "⚡ Power & Energy",
        "tab_color": "ED7D31",
        "color": "ED7D31",
        "description": "Power generation, grid maintenance & nuclear energy for the AI buildout",
        "stocks": [
            {"ticker": "GEV",   "company": "GE Vernova",      "focus": "Power generation & grid equipment",        "risk": "Medium",    "notes": "Stability and steady compounder. Power and grid maintenance for AI buildout."},
            {"ticker": "PWR",   "company": "Quanta Services", "focus": "Power grid infrastructure & maintenance",  "risk": "Medium",    "notes": "Power generation and grid maintenance. Growing bottleneck for AI buildout."},
            {"ticker": "BE",    "company": "Bloom Energy",    "focus": "Fuel cell power generation",              "risk": "High",      "notes": "Moonshot potential if hydrogen & fuel cell technology takes off."},
            {"ticker": "OKLO",  "company": "Oklo Inc",        "focus": "Nuclear SMRs + nuclear fuel waste",        "risk": "Very High", "notes": "Massive moonshot potential. Big regulatory & execution risk. Worth a small % of portfolio given massive potential."},
        ],
    },
    {
        "name": "☁️ Neoclouds & AI Software",
        "tab_color": "7030A0",
        "color": "5A2E8C",
        "description": "Next-gen cloud infrastructure and AI software platforms",
        "stocks": [
            {"ticker": "NBIS",  "company": "Nebius Group",           "focus": "Neocloud + Clickhouse + AV Ride",       "risk": "High",      "notes": "Leading Neocloud with multiple revenue streams (Clickhouse, AV Ride). Modern Amazon/Google style company. Could become a future Hyperscaler."},
            {"ticker": "PLTR",  "company": "Palantir Technologies",  "focus": "AI software, government AI stack",      "risk": "Med-High",  "notes": "Integral to the entire government AI stack. Not going anywhere. AI Software outlier outside the data center trade."},
        ],
    },
    {
        "name": "🛡️ Defense & Drones",
        "tab_color": "595959",
        "color": "595959",
        "description": "Defense technology and drone companies — $1.5T defense budget tailwind",
        "stocks": [
            {"ticker": "ONDS",  "company": "Ondas Holdings",  "focus": "Drones and defense tech",  "risk": "Very High", "notes": "$1.5T defense budget, $56B to drones/counter-drones via DAWG Program. Best chance to scale after March 2026 acquisitions & partnerships. Very speculative."},
        ],
    },
    {
        "name": "🚀 Space Economy",
        "tab_color": "002060",
        "color": "002060",
        "description": "Space infrastructure — long-duration compounder with SpaceX IPO catalyst",
        "stocks": [
            {"ticker": "RKLB",  "company": "Rocket Lab USA",  "focus": "Space economy & launch infrastructure",  "risk": "High", "notes": "Huge future TAM over next decade+. Speculative but massive upside. Brilliant CEO. Near-term catalyst: SpaceX IPO in June."},
        ],
    },
    {
        "name": "🔭 Long Term Watchlist",
        "tab_color": "2E75B6",
        "color": "2E75B6",
        "description": "Long-term investment research candidates under active evaluation",
        "stocks": [
            {"ticker": "RBRK",  "company": "Rubrik Inc",       "focus": "Cybersecurity, data management",   "risk": "Med-High",  "notes": "Long term investment research candidate."},
            {"ticker": "NVO",   "company": "Novo Nordisk",     "focus": "GLP-1 drugs, diabetes & obesity",  "risk": "Medium",    "notes": "Long term investment research candidate."},
        ],
    },
    {
        "name": "📝 Research Notes",
        "tab_color": "1B2A4A",
        "color": "1B2A4A",
        "description": "",
        "stocks": [],
    },
]

# ── Column definitions for tracker sheets ────────────────────────────────────
COLS = [
    ("Ticker",              10,  False),   # 1  A
    ("Company",             28,  False),   # 2  B
    ("Focus / Niche",       30,  False),   # 3  C
    ("Risk",                11,  False),   # 4  D
    ("Current\nPrice",      12,  True),    # 5  E - yellow input
    ("Today's\n+/- %",      11,  False),   # 6  F - green/red auto
    ("Purchase\nPrice",     12,  True),    # 7  G - yellow input
    ("Shares\nOwned",       10,  True),    # 8  H - yellow input
    ("Total\nCost",         13,  False),   # 9  I = G*H
    ("Current\nValue",      13,  False),   # 10 J = E*H
    ("P&L ($)",             13,  False),   # 11 K = J-I
    ("P&L (%)",             10,  False),   # 12 L = K/I
    ("52W\nHigh",           11,  True),    # 13 M - yellow input
    ("52W\nLow",            11,  True),    # 14 N - yellow input
    ("% from\n52W High",    12,  False),   # 15 O = E/M-1
    ("Analyst\nTarget",     12,  True),    # 16 P - yellow input
    ("Upside to\nTarget",   12,  False),   # 17 Q = P/E-1
]

def col_letter(idx):  # 1-based
    return get_column_letter(idx)

def apply_header_row(ws, row, cat_color, names_widths):
    for ci, (name, width, is_input) in enumerate(names_widths, 1):
        cell = ws.cell(row=row, column=ci, value=name)
        cell.fill = fill(cat_color)
        cell.font = font(bold=True, color=WHITE, size=10)
        cell.alignment = center()
        cell.border = hdr_border()

def write_stock_row(ws, row, stock, cat_color):
    tickers_col  = 1   # A
    company_col  = 2   # B
    focus_col    = 3   # C
    risk_col     = 4   # D
    cur_col      = 5   # E - current price (yellow input)
    change_col   = 6   # F - today's +/-% (green/red auto)
    buy_col      = 7   # G - purchase price (yellow input)
    shares_col   = 8   # H - shares (yellow input)
    cost_col     = 9   # I = G*H
    val_col      = 10  # J = E*H
    pnl_col      = 11  # K = J-I
    pnlp_col     = 12  # L = K/I
    hi_col       = 13  # M - 52W High (yellow input)
    lo_col       = 14  # N - 52W Low (yellow input)
    fromhi_col   = 15  # O = E/M-1
    tgt_col      = 16  # P - analyst target (yellow input)
    upside_col   = 17  # Q = P/E-1

    bg = LIGHT_GRAY if row % 2 == 0 else WHITE

    def cell(col, value=None, formula=None, fmt=None, is_input=False):
        c = ws.cell(row=row, column=col, value=value if formula is None else formula)
        c.border = THIN_BORDER
        c.alignment = left() if col in (company_col, focus_col) else center()
        if is_input:
            c.fill = fill(YELLOW_IN)
        else:
            c.fill = fill(bg)
        if fmt:
            c.number_format = fmt
        return c

    # Static data
    c = cell(tickers_col, stock["ticker"])
    c.font = Font(bold=True, color="000070C0", name="Calibri", size=11)
    cell(company_col, stock["company"])
    cell(focus_col,   stock["focus"])
    cell(risk_col,    stock["risk"])

    # Current price — pre-filled with live data (yellow so user can override)
    live_price = stock.get("live_price", 0.00)
    cell(cur_col, live_price, is_input=True, fmt='"$"#,##0.00')

    # Today's +/-% — store as e.g. 5.27 (not 0.0527), display with literal %
    # so Excel does NOT apply its built-in ×100 multiplication
    daily_chg = stock.get("daily_change", None)
    chg_cell = ws.cell(row=row, column=change_col)
    chg_cell.border = THIN_BORDER
    chg_cell.alignment = center()
    if daily_chg is not None:
        pct_value = daily_chg * 100   # e.g. 0.052728 → 5.2728
        chg_cell.value = pct_value
        # '+0.00"%"' uses a literal % so no auto-multiplication
        chg_cell.number_format = '+0.00"%";-0.00"%";0.00"%"'
        if pct_value > 0:
            chg_cell.fill = fill("375623")   # dark green bg
            chg_cell.font = Font(bold=True, color=WHITE, size=11, name="Calibri")
        elif pct_value < 0:
            chg_cell.fill = fill("9C0006")   # dark red bg
            chg_cell.font = Font(bold=True, color=WHITE, size=11, name="Calibri")
        else:
            chg_cell.fill = fill(bg)
            chg_cell.font = Font(bold=True, color="595959", size=11, name="Calibri")
    else:
        chg_cell.value = None
        chg_cell.number_format = '0.00"%"'
        chg_cell.fill = fill(bg)

    cell(buy_col,    0.00, is_input=True, fmt='"$"#,##0.00')
    cell(shares_col, 0,    is_input=True, fmt='#,##0')

    r = row
    # Formulas — note column letters shifted by 1
    cell(cost_col,   formula=f"=G{r}*H{r}",             fmt='"$"#,##0.00')
    cell(val_col,    formula=f"=E{r}*H{r}",              fmt='"$"#,##0.00')
    cell(pnl_col,    formula=f"=J{r}-I{r}",              fmt='"$"#,##0.00')
    cell(pnlp_col,   formula=f'=IFERROR(K{r}/I{r},"")',  fmt='0.00%')

    cell(hi_col,     0.00, is_input=True, fmt='"$"#,##0.00')
    cell(lo_col,     0.00, is_input=True, fmt='"$"#,##0.00')
    cell(fromhi_col, formula=f'=IFERROR(E{r}/M{r}-1,"")', fmt='0.00%')

    cell(tgt_col,    0.00, is_input=True, fmt='"$"#,##0.00')
    cell(upside_col, formula=f'=IFERROR(P{r}/E{r}-1,"")',  fmt='0.00%')


def build_tracker_sheet(wb, cat, fetched_at=""):
    ws = wb[cat["name"]]
    ws.sheet_properties.tabColor = cat["tab_color"]
    ws.freeze_panes = "A4"
    ws.row_dimensions[1].height = 28
    ws.row_dimensions[2].height = 18
    ws.row_dimensions[3].height = 32

    cat_color = cat["color"]

    # Row 1 — Category title
    ws.merge_cells(f"A1:{col_letter(len(COLS))}1")
    title_cell = ws["A1"]
    title_cell.value = cat["name"]
    title_cell.fill = fill(cat_color)
    title_cell.font = Font(bold=True, color=WHITE, size=14, name="Calibri")
    title_cell.alignment = center()

    # Row 2 — Description
    ws.merge_cells(f"A2:{col_letter(len(COLS))}2")
    desc_cell = ws["A2"]
    desc_cell.value = cat["description"]
    desc_cell.fill = fill("D9E1F2")
    desc_cell.font = Font(italic=True, color=DARK_BLUE, size=10, name="Calibri")
    desc_cell.alignment = left()

    # Row 3 — Legend
    ws.merge_cells(f"A3:{col_letter(len(COLS))}3")
    leg = ws["A3"]
    leg.value = f"🟡 Yellow cells = your inputs  |  All other cells auto-calculate  |  📡 Prices fetched: {fetched_at}"
    leg.fill = fill(YELLOW_IN)
    leg.font = Font(italic=True, color="7F6000", size=9, name="Calibri")
    leg.alignment = center()

    # Row 4 — Column headers
    apply_header_row(ws, 4, cat_color, COLS)

    # Stock rows
    first_data = 5
    for i, stock in enumerate(cat["stocks"]):
        write_stock_row(ws, first_data + i, stock, cat_color)

    last_data = first_data + len(cat["stocks"]) - 1

    # Summary totals row
    if cat["stocks"]:
        tot_row = last_data + 2
        ws.row_dimensions[tot_row].height = 20
        ws.merge_cells(f"A{tot_row}:G{tot_row}")
        tot_label = ws[f"A{tot_row}"]
        tot_label.value = "PORTFOLIO TOTALS"
        tot_label.fill = fill(cat_color)
        tot_label.font = Font(bold=True, color=WHITE, size=11, name="Calibri")
        tot_label.alignment = center()

        for ci, col_name in [(8, "Total Cost"), (9, "Current Value"), (10, "P&L ($)")]:
            c = ws.cell(row=tot_row, column=ci)
            cl = col_letter(ci)
            c.value = f"=SUM({cl}{first_data}:{cl}{last_data})"
            c.fill = fill(cat_color)
            c.font = Font(bold=True, color=WHITE, size=11, name="Calibri")
            c.alignment = center()
            c.number_format = '"$"#,##0.00'
            c.border = hdr_border()

        pnlp_tot = ws.cell(row=tot_row, column=11)
        pnlp_tot.value = f"=IFERROR(J{tot_row}/H{tot_row},\"\")"
        pnlp_tot.fill = fill(cat_color)
        pnlp_tot.font = Font(bold=True, color=WHITE, size=11, name="Calibri")
        pnlp_tot.alignment = center()
        pnlp_tot.number_format = "0.00%"
        pnlp_tot.border = hdr_border()

        # Conditional formatting P&L $ column
        green_rule = CellIsRule(operator="greaterThan", formula=["0"],
                                fill=fill(GREEN_BG), font=Font(color=GREEN_FONT, bold=True, name="Calibri"))
        red_rule   = CellIsRule(operator="lessThan",   formula=["0"],
                                fill=fill(RED_BG),   font=Font(color=RED_FONT,   bold=True, name="Calibri"))
        rng_pnl  = f"J{first_data}:J{last_data}"
        rng_pnlp = f"K{first_data}:K{last_data}"
        ws.conditional_formatting.add(rng_pnl,  green_rule)
        ws.conditional_formatting.add(rng_pnl,  red_rule)
        ws.conditional_formatting.add(rng_pnlp, green_rule)
        ws.conditional_formatting.add(rng_pnlp, red_rule)

        # ── Notes section below totals ─────────────────────────────────────
        last_col_letter = col_letter(len(COLS))
        notes_start = tot_row + 2

        # Section header — full width
        ws.merge_cells(f"A{notes_start}:{last_col_letter}{notes_start}")
        nh = ws[f"A{notes_start}"]
        nh.value = "📌  INVESTMENT THESIS & RESEARCH NOTES"
        nh.fill = fill(cat_color)
        nh.font = Font(bold=True, color=WHITE, size=11, name="Calibri")
        nh.alignment = left()
        ws.row_dimensions[notes_start].height = 22

        cur_row = notes_start + 1

        for j, stock in enumerate(cat["stocks"]):
            bg_note = LIGHT_GRAY if j % 2 == 0 else WHITE
            note_text = stock.get("notes", "")

            # ── Row A: Ticker | Company (full width, bold label row) ──────
            label_row = cur_row
            ws.merge_cells(f"A{label_row}:{last_col_letter}{label_row}")
            lc = ws[f"A{label_row}"]
            lc.value = f"  {stock['ticker']}  —  {stock['company']}  |  Risk: {stock['risk']}"
            lc.fill = fill("D9E1F2")
            lc.font = Font(bold=True, color=DARK_BLUE, size=10, name="Calibri")
            lc.alignment = Alignment(horizontal="left", vertical="center")
            lc.border = Border(top=side("medium"), left=side("medium"), right=side("medium"))
            ws.row_dimensions[label_row].height = 18
            cur_row += 1

            # ── Row B: Full-width note text ───────────────────────────────
            note_row = cur_row
            # Estimate lines: full 17-col width ≈ 220 chars per line
            chars_per_line = 220
            lines_needed = max(2, (len(note_text) // chars_per_line) + note_text.count("\n") + 1)
            ws.row_dimensions[note_row].height = max(52, lines_needed * 18 + 10)

            ws.merge_cells(f"A{note_row}:{last_col_letter}{note_row}")
            nc = ws[f"A{note_row}"]
            nc.value = note_text
            nc.fill = fill(bg_note)
            nc.font = Font(color="1B2A4A", size=10, name="Calibri")
            nc.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
            nc.border = Border(bottom=side("medium"), left=side("medium"), right=side("medium"))
            cur_row += 1

    # Column widths
    for ci, (_, width, _) in enumerate(COLS, 1):
        ws.column_dimensions[col_letter(ci)].width = width

    return ws


def build_dashboard(wb, categories, fetched_at=""):
    ws = wb.active
    ws.title = "📊 Dashboard"
    ws.sheet_properties.tabColor = "1B2A4A"
    ws.freeze_panes = "A6"

    # Title banner
    ws.merge_cells("A1:P1")
    t = ws["A1"]
    t.value = "📈 PERSONAL STOCK TRACKER — PORTFOLIO DASHBOARD"
    t.fill = fill(DARK_BLUE)
    t.font = Font(bold=True, color="FFD700", size=16, name="Calibri")
    t.alignment = center()
    ws.row_dimensions[1].height = 36

    ws.merge_cells("A2:P2")
    sub = ws["A2"]
    sub.value = "Update prices in each category tab. This dashboard auto-totals across all categories."
    sub.fill = fill(MID_BLUE)
    sub.font = Font(italic=True, color=WHITE, size=10, name="Calibri")
    sub.alignment = center()
    ws.row_dimensions[2].height = 18

    ws.merge_cells("A3:P3")
    leg3 = ws["A3"]
    leg3.value = f"🟡 Yellow cells = your inputs  |  All other cells auto-calculate  |  Green = gain  |  Red = loss  |  📡 Prices fetched: {fetched_at}"
    leg3.fill = fill(YELLOW_IN)
    leg3.font = Font(italic=True, color="7F6000", size=9, name="Calibri")
    leg3.alignment = center()
    ws.row_dimensions[3].height = 16

    ws.row_dimensions[4].height = 8

    # Summary header row 5
    dash_cols = ["Category", "# Stocks", "Risk Profile", "Theme", "Total Cost", "Current Value", "P&L ($)", "P&L (%)"]
    dash_widths = [26, 10, 14, 38, 16, 16, 14, 10]
    for ci, (col_name, w) in enumerate(zip(dash_cols, dash_widths), 1):
        c = ws.cell(row=5, column=ci, value=col_name)
        c.fill = fill(DARK_BLUE)
        c.font = Font(bold=True, color=WHITE, size=11, name="Calibri")
        c.alignment = center()
        c.border = hdr_border()
        ws.column_dimensions[col_letter(ci)].width = w

    ws.row_dimensions[5].height = 22

    themes = {
        "⚛️ Quantum Computing":      "High-risk quantum plays — 10× potential",
        "🖥️ Semiconductors & Compute": "Core compute names — stability & compounders",
        "⚙️ AI Picks & Shovels":       "Smaller-cap NVDA-adjacent — asymmetric upside",
        "💡 Photonics & Optics":       "Optical interconnect — key AI DC bottleneck",
        "🏗️ DC Builders & Cooling":    "Data center construction & cooling plays",
        "⚡ Power & Energy":            "Power generation, grid & nuclear for AI buildout",
        "☁️ Neoclouds & AI Software":  "Next-gen cloud & government AI software",
        "🛡️ Defense & Drones":         "$1.5T defense budget — drone & defense tech",
        "🚀 Space Economy":            "Space infrastructure — SpaceX IPO catalyst",
        "🔭 Long Term Watchlist":      "Research candidates under active evaluation",
    }
    risk_profiles = {
        "⚛️ Quantum Computing":      "Very High",
        "🖥️ Semiconductors & Compute": "Medium",
        "⚙️ AI Picks & Shovels":       "High",
        "💡 Photonics & Optics":       "High",
        "🏗️ DC Builders & Cooling":    "Low-Medium",
        "⚡ Power & Energy":            "Medium-High",
        "☁️ Neoclouds & AI Software":  "Medium-High",
        "🛡️ Defense & Drones":         "Very High",
        "🚀 Space Economy":            "High",
        "🔭 Long Term Watchlist":      "Mixed",
    }

    data_cats = [c for c in categories if c["stocks"]]
    summary_rows = []

    for i, cat in enumerate(data_cats):
        row = 6 + i
        ws.row_dimensions[row].height = 20
        bg = LIGHT_GRAY if i % 2 == 0 else WHITE
        cat_name = cat["name"]
        n_stocks = len(cat["stocks"])
        theme = themes.get(cat_name, "")
        risk = risk_profiles.get(cat_name, "")

        cells_data = [cat_name, n_stocks, risk, theme, "", "", "", ""]
        for ci, val in enumerate(cells_data, 1):
            c = ws.cell(row=row, column=ci, value=val)
            c.fill = fill(bg)
            c.border = THIN_BORDER
            c.alignment = left() if ci in (1, 4) else center()
            if ci == 1:
                c.font = Font(bold=True, color="00" + cat["color"], name="Calibri", size=11)

        summary_rows.append(row)

    # Grand total row
    tot_row = 6 + len(data_cats) + 1
    ws.row_dimensions[tot_row].height = 24
    ws.merge_cells(f"A{tot_row}:D{tot_row}")
    gt = ws[f"A{tot_row}"]
    gt.value = "GRAND TOTAL — ALL CATEGORIES"
    gt.fill = fill(DARK_BLUE)
    gt.font = Font(bold=True, color="FFD700", size=12, name="Calibri")
    gt.alignment = center()
    for ci in range(1, 9):
        c = ws.cell(row=tot_row, column=ci)
        c.fill = fill(DARK_BLUE)
        c.border = hdr_border()

    # Key notes section
    note_row = tot_row + 3
    ws.merge_cells(f"A{note_row}:H{note_row}")
    nh = ws[f"A{note_row}"]
    nh.value = "📌  KEY RESEARCH NOTES & THESIS"
    nh.fill = fill(MID_BLUE)
    nh.font = Font(bold=True, color=WHITE, size=12, name="Calibri")
    nh.alignment = left()
    ws.row_dimensions[note_row].height = 22

    notes_text = [
        ("To-Do Actions",
         "• Transfer 401k from Accrue/Vestwell → Charles Schwab\n• Transfer 401k from Vanguard → Charles Schwab\n• Open Capital One Savings Account (for holding taxes)\n• Learn Unusual Whales website (watch YouTube tutorials)"),
        ("AI Infrastructure Thesis",
         "The AI trade is no longer just about GPUs. It is shifting down stack into:\n  Memory Names | Photonics & Optics | CPU Makers (INTC, AMD, ARM, NVDA)\n  Data Center Builders & Materials (CAT, FIX, POWL) | Cooling (VRT, FIX)\n  Power Generation & Grid (GEV, BE, PWR) | Nuclear (OKLO)"),
        ("What Connects Small-Cap AI Names",
         "These are not mini-NVDA clones. They represent:\n  1. AI Infrastructure Bottlenecks: power (NVTS), chip testing (AEHR), data movement (CRDO/MTSI), efficiency (ALGM)\n  2. Early Monetization Phase: revenue exists but still scaling\n  3. Narrative Sensitivity: move on earnings beats, guidance raises, AI capex headlines"),
        ("Recommended Core Portfolio Mix",
         "LRCX (stability) | DRAM ETF | LITE (photonics moonshot) | NVDA (stability) | AVGO (stability)\nFIX or POWL or CAT (pick one) | GEV (stability) | BE (if hydrogen thesis) | OKLO (nuclear moonshot, small %)\nNBIS (future hyperscaler) | PLTR (gov AI software) | ONDS (drone defense, speculative) | RKLB (space economy)"),
        ("Quantum Run Note",
         "Next run will be quantum. Buy IONQ, RGTI, and QBTS. Easy 10× within 2 years."),
        ("Three Outliers Outside Data Center Trade",
         "PLTR — AI Software. Integral to entire government AI stack.\nONDS — Drones & Defense. $1.5T defense budget, $56B specifically to drones via DAWG Program.\nRKLB — Space Economy. Huge future TAM. SpaceX IPO in June is a near-term catalyst."),
    ]

    for j, (heading, body) in enumerate(notes_text):
        h_row = note_row + 1 + j * 4
        ws.merge_cells(f"A{h_row}:H{h_row}")
        hc = ws[f"A{h_row}"]
        hc.value = heading
        hc.fill = fill("D9E1F2")
        hc.font = Font(bold=True, color=DARK_BLUE, size=10, name="Calibri")
        hc.alignment = left()
        ws.row_dimensions[h_row].height = 18

        b_row = h_row + 1
        ws.merge_cells(f"A{b_row}:H{b_row + 2}")
        bc = ws[f"A{b_row}"]
        bc.value = body
        bc.fill = fill(WHITE)
        bc.font = Font(color="1B2A4A", size=9, name="Calibri")
        bc.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        bc.border = THIN_BORDER
        ws.row_dimensions[b_row].height = 60

    return ws


def build_notes_sheet(wb):
    ws = wb["📝 Research Notes"]
    ws.sheet_properties.tabColor = "1B2A4A"

    ws.merge_cells("A1:G1")
    t = ws["A1"]
    t.value = "📝 RESEARCH NOTES & INVESTMENT THESIS"
    t.fill = fill(DARK_BLUE)
    t.font = Font(bold=True, color="FFD700", size=14, name="Calibri")
    t.alignment = center()
    ws.row_dimensions[1].height = 30
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 80

    notes = [
        ("401k To-Do",            "• Transfer 401k from Accrue (Now Vestwell) → Charles Schwab\n• Transfer 401k from Vanguard (1-800-523-1188) → Charles Schwab"),
        ("Savings Account",       "• Open Savings Account with Capital One (for holding taxes)"),
        ("Research Tools",        "• Learn how to use 'Unusual Whales' website — watch YouTube tutorials"),
        ("Quantum Thesis",        "Next run will be of quantum. Buy IONQ, RGTI, and QBTS. Easy 10× within 2 years."),
        ("NVTS",                  "Navitas Semiconductor — GaN power chips. AI data centers need radically more efficient power delivery. NVDA parallel: picks-and-shovels for compute growth. High-risk bet on next-gen power architecture shift."),
        ("AEHR",                  "AEHR Test Systems — Semiconductor burn-in and test equipment. AI chips require more advanced testing at scale. More chips → more testing bottleneck demand. Classic shovels in a gold rush setup."),
        ("CRDO",                  "Credo Technology — High-speed connectivity / SerDes for AI data centers. GPUs don't matter if data can't move between them. Direct exposure to AI cluster networking buildout. One of the cleanest AI infrastructure picks-and-shovels names."),
        ("ALGM",                  "Allegro MicroSystems — Power & sensing semiconductors. Electrification + AI hardware power efficiency. Steady but still early in AI rerating narrative. More of a quiet compounder than hype stock."),
        ("HIMX",                  "Himax Technologies — Display drivers + AR/AI vision chips. Exposure to AI edge devices + optics. Often overlooked ADR with cyclical breakout behavior. Higher volatility, but historically rerates fast on cycles."),
        ("MTSI",                  "MACOM — RF, microwave, high-speed analog chips. AI datacenter interconnect + telecom backbone. Beneficiary of long-term bandwidth expansion trend. Less hype, more industrial AI backbone exposure."),
        ("AEVA",                  "Aeva Technologies — Lidar + sensing tech. Autonomous systems + robotics long tail. Still early commercialization phase. Pure asymmetric bet: low probability, high upside."),
        ("AI Infrastructure",     "The AI trade is shifting down stack: Memory Names | Photonics & Optics | CPU Makers (INTC, AMD, ARM, NVDA) | Actual Builders & Materials (CAT, FIX, POWL) | Cooling Companies (VRT, FIX) | Power Generation & Grid (GEV, BE, PWR)"),
        ("LITE",                  "Lumentum — King of Photonics. Could moonshot. Critical infrastructure for AI data movement."),
        ("OKLO",                  "Nuclear SMRs and Nuclear Fuel Waste. Huge moonshot potential but big regulatory and execution risk. Worth a small percentage of portfolio because of its massive potential."),
        ("NBIS",                  "Nebius Group — Leading Neocloud that also owns Clickhouse and AV Ride. This is a modern day Amazon or Google style company — main product plus several other revenue streams that could be massive in the future. I think this will be a future Hyperscaler like GOOGL, Amazon, META."),
        ("PLTR",                  "Palantir — AI Software. So integral to the entire government AI stack and is not going anywhere soon. Outlier outside of the data center trade."),
        ("ONDS",                  "Ondas Holdings — Drones and defense tech. Government just announced a new $1.5 Trillion defense budget with $56 Billion going specifically to drones and counter-drones through the DAWG Program. Very speculative but best chance to scale after their recent acquisitions and partnerships made in March 2026."),
        ("RKLB",                  "Rocket Lab — Space Economy and Space Infrastructure. Huge future potential TAM over the next decade or two. Speculative for sure but huge upside potential that will compound over time if they can execute. Brilliant CEO. Will run into the SpaceX IPO in June in the near term."),
        ("Recommended Portfolio", "LRCX (stability) | DRAM ETF | LITE (photonics moonshot) | NVDA (stability) | AVGO (stability) | FIX or POWL or CAT (pick one) | GEV (stability) | BE (hydrogen moonshot) | OKLO (nuclear moonshot, small %) | NBIS (future hyperscaler)"),
    ]

    for i, (heading, body) in enumerate(notes, 2):
        ws.row_dimensions[i].height = max(15, body.count("\n") * 15 + 20)
        hc = ws.cell(row=i, column=1, value=heading)
        hc.fill = fill("D9E1F2" if i % 2 == 0 else LIGHT_GRAY)
        hc.font = Font(bold=True, color=DARK_BLUE, size=10, name="Calibri")
        hc.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        hc.border = THIN_BORDER

        bc = ws.cell(row=i, column=2, value=body)
        bc.fill = fill(WHITE)
        bc.font = Font(color="1B2A4A", size=9, name="Calibri")
        bc.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        bc.border = THIN_BORDER


# ── Fetch live prices ─────────────────────────────────────────────────────────
def fetch_live_prices(categories):
    all_tickers = []
    for cat in categories:
        for stock in cat.get("stocks", []):
            all_tickers.append(stock["ticker"])

    print(f"Fetching live prices + today's change for {len(all_tickers)} tickers...")
    prices = {}
    daily_changes = {}
    try:
        tickers_obj = yf.Tickers(" ".join(all_tickers))
        for t in all_tickers:
            try:
                fi         = tickers_obj.tickers[t].fast_info
                last_price = fi.last_price
                prev_close = fi.previous_close
                if last_price:
                    prices[t] = round(float(last_price), 2)
                if last_price and prev_close and prev_close != 0:
                    daily_changes[t] = float((last_price - prev_close) / prev_close)
            except Exception:
                pass
        print(f"  ✓ Got prices for {len(prices)} tickers, daily changes for {len(daily_changes)}")
    except Exception as e:
        print(f"  ⚠ Price fetch failed: {e}. Using 0.00 placeholders.")

    fetched_at = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    return prices, daily_changes, fetched_at


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # Fetch live prices + daily changes
    live_prices, daily_changes, fetched_at = fetch_live_prices(CATEGORIES)

    # Inject prices and daily changes into stock dicts
    for cat in CATEGORIES:
        for stock in cat.get("stocks", []):
            t = stock["ticker"]
            stock["live_price"]   = round(live_prices.get(t, 0.00), 2)
            stock["daily_change"] = daily_changes.get(t, None)

    wb = openpyxl.Workbook()

    # Pre-create all sheets so ordering is correct
    for cat in CATEGORIES:
        if cat["name"] == "📊 Dashboard":
            continue
        wb.create_sheet(cat["name"])

    build_dashboard(wb, CATEGORIES, fetched_at)

    for cat in CATEGORIES:
        if cat["name"] in ("📊 Dashboard", "📝 Research Notes"):
            continue
        if cat["stocks"]:
            build_tracker_sheet(wb, cat, fetched_at)

    build_notes_sheet(wb)

    # Move dashboard to front
    wb.move_sheet("📊 Dashboard", offset=-len(wb.sheetnames))

    out_path = "/home/runner/workspace/Financial_Stock_Tracker.xlsx"
    wb.save(out_path)
    print(f"Saved → {out_path}")

main()
