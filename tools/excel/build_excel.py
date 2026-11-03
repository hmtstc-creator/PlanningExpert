"""Builds the PlanningExpert Excel planning workbook (.xlsm).

    python3 tools/excel/build_excel.py            -> docs/excel/*.xlsm

Two files: an empty template and the same workbook filled with a small example
(plan date fixed) so the engine can be tried at once. Default settings are read
from src/lib/settingsDefaults.ts so they never drift from the website.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
import sys
from pathlib import Path

import xlsxwriter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from vba_project import build_vba_project, document_module  # noqa: E402

OUT_DIR = ROOT / "docs" / "excel"


def code_defaults() -> dict:
    text = (ROOT / "src/lib/settingsDefaults.ts").read_text(encoding="utf-8")
    block = text.split("export const SETTINGS_DEFAULTS = {", 1)[1].split("} as const", 1)[0]
    out: dict = {}
    for key, value in re.findall(r"^\s*(\w+):\s*([^,\n]+),", block, re.M):
        value = value.strip()
        if value in ("true", "false"):
            out[key] = value == "true"
        elif value.startswith("'"):
            out[key] = value.strip("'")
        else:
            out[key] = float(value) if "." in value else int(value)
    pipeline = (ROOT / "src/lib/planPipeline.ts").read_text(encoding="utf-8")
    m = re.search(r"for \(let round = 0; round < (\d+); round\+\+\)", pipeline)
    out["repairRounds"] = int(m.group(1)) if m else 6
    return out


def hhmm(minutes: int) -> dt.time:
    return dt.time(int(minutes // 60) % 24, int(minutes % 60))


SHEETS = [
    "Start", "Settings", "Master Data", "Work Centers", "Day Shifts", "Holidays", "Planned Stops",
    "Storage Locations", "MB52", "ZPP", "ZPP_DAILY", "Lots", "Production Plan", "Unplanned", "Load", "Check",
]

HEADERS = {
    "Master Data": [
        ("Material", 16), ("Description", 24), ("Main work center", 14), ("Alt work center 1", 12),
        ("Alt work center 2", 12), ("Alt work center 3", 12), ("Alt work center 4", 12), ("Flexible (Y/N)", 10),
        ("Cycle time (min/pc)", 12), ("SPM (old, if no cycle time)", 12), ("Cavities", 9),
        ("Gross weight (kg/pc)", 12), ("Coil weight (kg)", 11), ("Min. lot (pcs)", 11), ("Setup (min)", 9),
        ("Coil change (min)", 10), ("Quality approval (min)", 11), ("Performance factor (0-1)", 12),
        ("Max shots (die limit)", 11), ("Co-product (not modelled)", 14),
    ],
    "Work Centers": [("Work center", 14), ("Hall", 10), ("Feeds coil (Y/N)", 10), ("Working days / week", 12), ("Shifts / day", 10)],
    "Day Shifts": [("Work center (* = all)", 18), ("Date", 12), ("Shifts that day", 12)],
    "Holidays": [("Date", 12), ("Name", 30)],
    "Planned Stops": [("Shift (1-3)", 10), ("Name", 22), ("Kind (tea / meal / break / handover / maintenance / other)", 22), ("Start (HH:MM)", 12), ("Duration (min)", 12)],
    "Storage Locations": [("Storage location", 16), ("Count as finished goods (Y/N)", 18), ("Description", 30)],
    "MB52": [("Material", 16), ("Plant", 8), ("Storage location", 14), ("Unrestricted", 14)],
    "ZPP": [("Material", 16), ("Overdue (backlog)", 14)],
    "ZPP_DAILY": [("Material", 16)],
    "Lots": [
        ("#", 6), ("Material", 16), ("Bucket", 10), ("Lot qty", 10), ("Lot rule", 10), ("Phase", 9),
        ("Long-term", 9), ("Stock-out date", 12), ("May start", 12), ("Delivery deadline", 16),
        ("Need share", 10), ("Checkpoints (date share)", 34), ("Note", 26),
    ],
    "Production Plan": [
        ("#", 6), ("Work center", 12), ("Hall", 8), ("Material", 16), ("Bucket", 10), ("Phase", 9), ("Qty", 10),
        ("Coils", 7), ("Setup start", 16), ("Setup (min)", 9), ("Quality (min)", 9), ("Production start", 16),
        ("End", 16), ("Run (min)", 10), ("Occupied (net min)", 11), ("Delivery deadline", 16), ("Ready at", 16),
        ("Late", 7), ("Late (h)", 8), ("Setup rule", 18), ("Reason", 70), ("Placement step", 9),
    ],
    "Unplanned": [("Material", 16), ("Bucket", 10), ("Qty", 10), ("Phase", 14), ("Stock-out date", 12), ("Reason", 70)],
    "Load": [("Work center", 14), ("Hall", 8), ("Week (Monday)", 13), ("Capacity (h)", 12), ("Planned (h)", 12), ("Load %", 9), ("Free (h)", 10)],
    "Check": [("Area", 14), ("Status", 11), ("Detail", 110)],
}

INPUT_SHEETS = {"Master Data", "Work Centers", "Day Shifts", "Holidays", "Planned Stops", "Storage Locations", "MB52", "ZPP", "ZPP_DAILY"}

# ---------------------------------------------------------------------------
# Example data (small plant: 2 halls, 5 work centers, 10 materials)
# ---------------------------------------------------------------------------
EXAMPLE_PLAN_DATE = dt.date(2026, 11, 3)  # Tuesday


def example() -> dict:
    monday = EXAMPLE_PLAN_DATE - dt.timedelta(days=EXAMPLE_PLAN_DATE.weekday())
    master = [
        # code, name, main, alt1, alt2, (alt3, alt4 added below), flexible, cycle, spm, cav, gross, coilKg, minLot, setup, coilMin, qa, perf, maxShots
        ["10010001", "Bracket front", "P100", "P200", "", "Y", 0.05, 0, 1, 0.8, 6000, 0, 60, 20, 15, 0.85, 0],
        ["10010002", "Bracket rear", "P100", "", "", "N", 0.06, 0, 2, 0.5, 5000, 0, 45, 20, 10, 0.9, 0],
        ["10010003", "Reinforcement", "P200", "P100", "", "Y", 0.08, 0, 1, 1.2, 7200, 0, 90, 25, 20, 0.8, 20000],
        ["10010004", "Side member", "P300", "", "", "N", 0.12, 0, 1, 3.5, 10500, 0, 120, 30, 30, 0.75, 0],
        ["10010005", "Cross member", "P300", "P400", "", "Y", 0.10, 0, 1, 2.0, 9000, 0, 90, 30, 20, 0.85, 0],
        ["10010006", "Hinge plate", "P400", "", "", "N", 0.04, 0, 4, 0.2, 4000, 0, 40, 15, 10, 0.9, 0],
        ["10010007", "Tunnel cover", "T500", "", "", "N", 0.20, 0, 1, 4.0, 1, 1500, 150, 0, 30, 0.8, 0],
        ["10010008", "Floor panel", "T500", "", "", "N", 0.25, 0, 1, 6.0, 1, 1000, 180, 0, 30, 0.8, 0],
        ["10010009", "Gusset", "P200", "", "", "N", 0, 40, 2, 0.3, 4500, 0, 50, 20, 10, 0, 0],
        ["10010010", "Nut plate", "P400", "", "", "N", 0.03, 0, 1, 0, 0, 0, 30, 0, 0, 1, 0],
    ]
    presses = [
        ["P100", "HALL-A", "Y", 5, 3], ["P200", "HALL-A", "Y", 5, 3], ["P300", "HALL-B", "Y", 5, 2],
        ["P400", "HALL-B", "Y", 6, 2], ["T500", "HALL-B", "N", 5, 3],
    ]
    stops = [[1, "Tea", "tea", "09:30", 15], [1, "Meal", "meal", "12:00", 30], [2, "Handover", "handover", "15:00", 10],
             [2, "Tea", "tea", "17:30", 15], [2, "Meal", "meal", "20:00", 30], [3, "Meal", "meal", "03:00", 30]]
    holidays = [[(monday + dt.timedelta(days=17)).isoformat(), "Example holiday (Thursday, week 3)"]]
    day_shifts = [["P300", (monday + dt.timedelta(days=5)).isoformat(), 2]]  # Saturday overtime on P300
    locations = [["1000", "Y", "Finished goods"], ["2000", "Y", "Production area (WIP)"], ["9000", "N", "Raw material"]]
    stock = [
        ["10010001", "PL01", "1000", 2500], ["10010002", "PL01", "1000", 9000], ["10010003", "PL01", "1000", 0],
        ["10010004", "PL01", "1000", 1200], ["10010004", "PL01", "2000", 300], ["10010005", "PL01", "1000", 5200],
        ["10010006", "PL01", "1000", 30000], ["10010007", "PL01", "1000", 400], ["10010008", "PL01", "1000", 2500],
        ["10010009", "PL01", "1000", 1000], ["10010010", "PL01", "1000", 0], ["10010001", "PL01", "9000", 99999],
    ]
    weeks = [f"W{(monday + dt.timedelta(days=7 * w)).isocalendar()[1]:02d}" for w in range(4)]
    zpp = [
        ["10010001", 1500, 6000, 6000, 6000, 6000],
        ["10010002", 0, 4000, 4000, 5000, 4000],
        ["10010003", 800, 3000, 3600, 3600, 3600],
        ["10010004", 0, 2500, 2500, 2500, 2500],
        ["10010005", 0, 3000, 3000, 3000, 3000],
        ["10010006", 0, 8000, 8000, 8000, 8000],
        ["10010007", 0, 1200, 1200, 1200, 1200],
        ["10010008", 0, 1500, 1500, 1500, 1500],
        ["10010009", 300, 2000, 2000, 2000, 2000],
        ["10010010", 0, 5000, 5000, 5000, 5000],
    ]
    # ZPP_DAILY: today .. next Friday for some materials (the rest stay weekly = long-term)
    daily_dates = [EXAMPLE_PLAN_DATE + dt.timedelta(days=i) for i in range(0, 11)]
    daily_dates = [d for d in daily_dates if d.weekday() < 5]
    daily = [
        ["10010001"] + [1200 if i % 2 == 0 else 1300 for i in range(len(daily_dates))],
        ["10010003"] + [700] * len(daily_dates),
        ["10010004"] + [500] * len(daily_dates),
        ["10010007"] + [250] * len(daily_dates),
        ["10010010"] + [1000] * len(daily_dates),
    ]
    master = [row[:5] + ["", ""] + row[5:] for row in master]
    return {
        "planDate": EXAMPLE_PLAN_DATE.isoformat(),
        "master": master, "presses": presses, "stops": stops, "holidays": holidays, "dayShifts": day_shifts,
        "locations": locations, "stock": stock, "weeks": weeks, "zpp": zpp,
        "dailyDates": [d.isoformat() for d in daily_dates], "daily": daily,
    }


def stress_example(seed: int, load: float = 1.0) -> dict:
    """Random, heavier data for the engine comparison (not shipped)."""
    import random

    rnd = random.Random(seed)
    base = example()
    monday = EXAMPLE_PLAN_DATE - dt.timedelta(days=EXAMPLE_PLAN_DATE.weekday())
    halls = ["H1", "H2", "H3"]
    presses = []
    for i in range(8):
        presses.append([f"M{i + 1}", halls[i % 3], "N" if i == 7 else "Y", rnd.choice([5, 5, 5, 6]), rnd.choice([2, 3, 3])])
    names = [p[0] for p in presses]
    master, zpp, stock, daily = [], [], [], []
    for i in range(30):
        code = f"2000{i:04d}"
        main = rnd.choice(names)
        flex = rnd.random() < 0.35
        alts = rnd.sample([n for n in names if n != main], 2) if flex else ["", ""]
        cav = rnd.choice([1, 1, 2, 4])
        min_lot = rnd.choice([0, 0, 0, 800, 1500]) if main != "M8" else rnd.choice([500, 1000])
        gross = round(rnd.uniform(0.2, 3.0), 3)
        coil = 1 if min_lot else rnd.choice([3000, 5000, 8000])
        cycle = round(rnd.uniform(0.02, 0.15), 3)
        weekly = int(rnd.uniform(600, 2600) * load / max(cycle, 0.03) / 20) * 10
        master.append([code, f"Part {i}", main, *alts, "", "", "Y" if flex else "N", cycle, 0, cav, gross, coil, min_lot,
                       rnd.choice([30, 45, 60, 90, 120, 150]), rnd.choice([0, 10, 20, 30]), rnd.choice([0, 10, 20, 30]),
                       rnd.choice([0, 0.7, 0.8, 0.9, 1]), rnd.choice([0, 0, 0, 15000, 30000])])
        overdue = rnd.choice([0, 0, 0, int(weekly * rnd.uniform(0.2, 0.8))])
        zpp.append([code, overdue] + [int(weekly * rnd.uniform(0.7, 1.3)) for _ in range(4)])
        stock.append([code, "PL01", rnd.choice(["1000", "1000", "2000", "9000"]), int(weekly * rnd.uniform(0, 1.2))])
        if rnd.random() < 0.5:
            daily.append([code] + [int(weekly / 5 * rnd.uniform(0.5, 1.5)) for _ in base["dailyDates"]])
    holidays = [[(monday + dt.timedelta(days=rnd.choice([10, 16, 23]))).isoformat(), "Holiday"]]
    day_shifts = [[rnd.choice(names), (monday + dt.timedelta(days=5 + 7 * w)).isoformat(), rnd.choice([1, 2, 3])] for w in range(3)]
    return {**base, "master": master, "presses": presses, "zpp": zpp, "stock": stock, "daily": daily,
            "holidays": holidays, "dayShifts": day_shifts}


def start_text(defaults: dict) -> list[tuple[str, str]]:
    return [
        ("title", "PlanningExpert - Planlama modülü (Excel)"),
        ("p", "Bu dosya PlanningExpert planlama motorunun çekirdeğini Excel'de çalıştırır: talep -> lot -> pres planı."),
        ("p", "Makrolar yalnız masaüstü Excel'de (Windows) çalışır. Açınca sarı şeritte 'İçeriği Etkinleştir'e basın."),
        ("p", "İnternetten indirilen dosyada makro engellenirse: dosyaya sağ tık > Özellikler > 'Engellemeyi kaldır'."),
        ("p", "Makrolar yine yüklenmezse: Alt+F11 > File > Import File > PlanEngine.bas (dosyanın yanında), sonra kaydedin."),
        ("h", "Nasıl kullanılır"),
        ("p", "1. Settings sayfasında plan tarihini ve ayarları kontrol edin (varsayılanlar programla aynıdır)."),
        ("p", "2. Master Data, Work Centers, Planned Stops, Holidays, Storage Locations: ana verileri yapıştırın."),
        ("p", "3. SAP çıktılarını yapıştırın: MB52, ZPP (haftalık), ZPP_DAILY (günlük). Başlık satırı 1. satırdır."),
        ("p", "   ZPP: 1. hafta sütunu = plan tarihinin haftası (C sütunu), sonra sırayla sonraki haftalar."),
        ("p", "   ZPP_DAILY: 1. satırda tarih başlıkları, A sütununda malzeme."),
        ("p", "4. 'Check data' ile ana veri hatalarını görün, sonra 'Run plan' ile planı kurun."),
        ("p", "5. Sonuç: Lots (lotlar), Production Plan (iş listesi), Unplanned, Load (haftalık doluluk), Check (kontroller)."),
        ("p", "   Check sayfasında ERROR satırı varsa plan kullanılmadan önce veri düzeltilmelidir."),
        ("h", "Programla aynı olan kurallar"),
        ("p", "- Talep: ZPP_DAILY kapsadığı günlerde tam tarihine, ötesinde haftalık ZPP iş günlerine eşit yayılır; bakiye bugündür."),
        ("p", "- ZPP_DAILY yüklüyse haftalık ZPP'den gelen talep 'uzun vade' lotudur: en son yerleşir, geç sayılmaz."),
        ("p", "- Stok: MB52 'Unrestricted', yalnız Storage Locations'ta Y olan depolar (deposu boş satır sayılır)."),
        ("p", "- Lot: tam rulo (rulo kg / brüt kg) ya da Min. lot katına yukarı; fazlası sonraki haftadan düşülür."),
        ("p", f"- Zaman: gün gün tahmini stok; stok bitiş günü, emniyet stoğu ({defaults['safetyStockDays']} iş günü) kadar önce başlayabilir."),
        ("p", "- Acil / dolgu / bakiye fazı, teslim kontrol noktaları, teslim saati (Delivery cut-off time)."),
        ("p", "- Süre: adet x çevrim süresi; performans faktörü işin toplam penceresini belirler; setup, kalite onayı, rulo değişimi."),
        ("p", "- Kalıp limiti (Max shots) aşılırsa lot tam rulo sınırında partilere bölünür."),
        ("p", "- Pres: ana pres, Flexible = Y ise alternatifler; en erken biten pres; geç kalmayan önce; aynı kalıbın setup'sız devamı."),
        ("p", "- Holde aynı anda setup sınırı + setup arası süre, rulo değişimi holde tek; fabrika geneli setup sınırı (normal / acil)."),
        ("p", "- Kalıp aynı anda iki preste olamaz; boşluğa giren iş sonraki işin setup'ını geri getirir."),
        ("p", f"- Dolgu lotu en fazla {defaults['pullForwardDays']} gün öne çekilir; geç iş onarımı {defaults['repairRounds']} tura kadar (en iyi plan seçilir)."),
        ("h", "Excel'de OLMAYAN kurallar (sitedeki plan bunlar yüzünden farklı olabilir)"),
        ("p", "- Senaryo araması ve yerel arama (sitede en iyi plan için yüzlerce sıra denenir)."),
        ("p", "- Eş ürün (co-product), takılı kalıp kuralı, onaylı / dondurulmuş plan, kilitli ve taşınmış işler, elle eklenen işler."),
        ("p", "- Mesai tanımları, istisna haftaları, operatör planı, kalıp bakımı / alarmı / hazırlığı, pres arızası, kapalı aralık."),
        ("p", "- Plan, plan tarihinin ilk vardiyasından başlar (o günün geçmiş saatleri düşülmez)."),
        ("p", "- Lot adedi elle değiştirme (plan overrides) ve hammadde (sac) planı."),
        ("h", "Kaynak"),
        ("p", "Kod: depoda tools/excel/PlanEngine.bas (VBA) - kurallar src/lib/planning.ts, scheduler.ts, planPipeline.ts'den aktarıldı."),
        ("p", "Dosyayı yeniden üretmek: python3 tools/excel/build_excel.py"),
    ]


def build(path: Path, data: dict | None, defaults: dict, vba_bin: bytes) -> None:
    wb = xlsxwriter.Workbook(str(path))
    wb.set_vba_name("ThisWorkbook")
    wb.add_vba_project(io.BytesIO(vba_bin), is_stream=True)
    wb.set_properties({"title": "PlanningExpert planning module", "company": "PlanningExpert"})
    head = wb.add_format({"bold": True, "bg_color": "#1F3A5F", "font_color": "#FFFFFF", "text_wrap": True, "valign": "top", "border": 1})
    head_in = wb.add_format({"bold": True, "bg_color": "#DDE7F3", "text_wrap": True, "valign": "top", "border": 1})
    f_date = wb.add_format({"num_format": "dd.mm.yyyy"})
    f_dt = wb.add_format({"num_format": "dd.mm.yyyy hh:mm"})
    f_time = wb.add_format({"num_format": "hh:mm"})
    f_pct = wb.add_format({"num_format": "0.0%"})
    f_num = wb.add_format({"num_format": "#,##0"})
    f_dec = wb.add_format({"num_format": "0.000"})
    title = wb.add_format({"bold": True, "font_size": 16, "font_color": "#1F3A5F"})
    h2 = wb.add_format({"bold": True, "font_size": 12, "font_color": "#1F3A5F"})
    wrap = wb.add_format({"text_wrap": False})

    sheets = {}
    for i, name in enumerate(SHEETS, start=1):
        ws = wb.add_worksheet(name)
        ws.set_vba_name(f"Sheet{i}")
        sheets[name] = ws
        if name in INPUT_SHEETS:
            ws.set_tab_color("#7FA7D9")
        elif name in ("Lots", "Production Plan", "Unplanned", "Load", "Check"):
            ws.set_tab_color("#3C8D5A")

    # ---- Start
    ws = sheets["Start"]
    ws.set_column("A:A", 3)
    ws.set_column("B:B", 120)
    row = 1
    for kind, text in start_text(defaults):
        ws.write(row, 1, text, title if kind == "title" else h2 if kind == "h" else wrap)
        row += 2 if kind in ("title", "h") else 1
        if kind == "title":
            for c, (macro, caption) in enumerate([("RunPlan", "Run plan"), ("CheckData", "Check data"), ("ClearOutputs", "Clear outputs")]):
                ws.insert_button(row, 1, {"macro": macro, "caption": caption, "width": 150, "height": 34, "x_offset": 10 + c * 165})
            row += 3
    ws.activate()

    # ---- Settings
    ws = sheets["Settings"]
    ws.set_column("A:A", 40)
    ws.set_column("B:B", 14)
    ws.set_column("C:C", 90)
    ws.write_row(0, 0, ["Setting", "Value", "Meaning (default comes from the website's settingsDefaults.ts)"], head)
    plan_date = dt.datetime.fromisoformat(data["planDate"]) if data else None
    rows = [
        ("Plan date", plan_date, f_date, "Today of the plan. The plan starts at the first shift of this day. Empty = today."),
        ("Planning horizon (weeks)", defaults["planningHorizonWeeks"], None, "Weeks planned from the Monday of the plan date (ZPP columns are read in this order)."),
        ("Shift length (min)", defaults["shiftMinutes"], None, "One shift; shifts run back to back from the first shift start."),
        ("First shift start", hhmm(defaults["shiftStartMinute"]), f_time, "Clock time of shift 1 (production day starts here)."),
        ("Safety stock (working days)", defaults["safetyStockDays"], None, "A lot may start this many working days before the stock runs out."),
        ("Capacity factor", defaults["capacityFactor"], None, "0-1: every day's net minutes x factor (measured performance)."),
        ("Delivery cut-off time", hhmm(defaults["deliveryCutoffMinute"]), f_time, "Pieces needed on a day must be ready by this time that morning."),
        ("Pull forward days (fill lots)", defaults["pullForwardDays"], None, "A fill lot may start at most this many days before its 'may start' day."),
        ("Setup gap in a hall (min)", defaults["setupGapMinutes"], None, "Minimum time between two die setups in the same hall."),
        ("Coil change gap in a hall (min)", defaults["coilSetupGapMinutes"], None, "Minimum time between two coil changes in the same hall."),
        ("Concurrent setups per hall", defaults["concurrentSetupsPerHall"], None, "Die setups at the same moment in one hall (crane)."),
        ("Max setups plant-wide (normal)", defaults["maxSetupsPlantWideNormal"], None, "Die setups at the same moment in the whole plant, normal jobs."),
        ("Max setups plant-wide (backlog / late)", defaults["maxSetupsPlantWide"], None, "Same, for backlog and jobs that would otherwise be late."),
        ("Setups may cross shift change", "Y" if defaults["setupsCrossShifts"] else "N", None, "Y: a setup may run over a shift change (never over the end of the day)."),
        ("Late-job repair rounds", defaults["repairRounds"], None, "Rounds that move late lots to the head of their phase and plan again."),
    ]
    for r, (label, value, fmt, note) in enumerate(rows, start=1):
        ws.write(r, 0, label)
        if label == "Plan date" and value is None:
            ws.write_formula(r, 1, "=TODAY()", f_date)
        elif fmt is not None and isinstance(value, (dt.datetime, dt.time)):
            ws.write_datetime(r, 1, value, fmt)
        else:
            ws.write(r, 1, value)
        ws.write(r, 2, note)

    # ---- headers + widths
    for name, cols in HEADERS.items():
        ws = sheets[name]
        fmt = head_in if name in INPUT_SHEETS else head
        for c, (label, width) in enumerate(cols):
            ws.write(0, c, label, fmt)
            ws.set_column(c, c, width)
        ws.freeze_panes(1, 1 if name in ("ZPP", "ZPP_DAILY", "Master Data") else 0)
        ws.set_row(0, 32)
    yn = {"validate": "list", "source": ["Y", "N"]}
    sheets["Master Data"].data_validation(1, 7, 5000, 7, yn)
    sheets["Work Centers"].data_validation(1, 2, 500, 2, yn)
    sheets["Storage Locations"].data_validation(1, 1, 500, 1, yn)
    sheets["Master Data"].set_column(8, 8, 12, f_dec)
    sheets["Day Shifts"].set_column(1, 1, 12, f_date)
    sheets["Holidays"].set_column(0, 0, 12, f_date)
    sheets["Planned Stops"].set_column(3, 3, 12, f_time)
    sheets["Planned Stops"].data_validation(1, 2, 500, 2, {"validate": "list", "source": ["tea", "meal", "break", "handover", "maintenance", "other"]})
    sheets["MB52"].set_column(3, 3, 14, f_num)
    lots = sheets["Lots"]
    lots.set_column(3, 3, 10, f_num)
    lots.set_column(7, 8, 12, f_date)
    lots.set_column(9, 9, 16, f_dt)
    pp = sheets["Production Plan"]
    pp.set_column(6, 6, 10, f_num)
    for c in (8, 11, 12, 15, 16):
        pp.set_column(c, c, 16, f_dt)
    pp.autofilter(0, 0, 0, len(HEADERS["Production Plan"]) - 1)
    sheets["Unplanned"].set_column(2, 2, 10, f_num)
    sheets["Unplanned"].set_column(4, 4, 12, f_date)
    load = sheets["Load"]
    load.set_column(2, 2, 13, f_date)
    load.set_column(5, 5, 9, f_pct)
    load.autofilter(0, 0, 0, 6)
    sheets["Lots"].autofilter(0, 0, 0, len(HEADERS["Lots"]) - 1)

    # week / date headers of ZPP and ZPP_DAILY
    zpp = sheets["ZPP"]
    weeks = data["weeks"] if data else [f"Week {i + 1}" for i in range(defaults["planningHorizonWeeks"])]
    for w, label in enumerate(weeks):
        zpp.write(0, 2 + w, label, head_in)
        zpp.set_column(2 + w, 2 + w, 10, f_num)
    zpp.write_comment(0, 2, "First week column = the week of the plan date (current week).")
    if data:
        dly = sheets["ZPP_DAILY"]
        for c, d in enumerate(data["dailyDates"]):
            dly.write_datetime(0, 1 + c, dt.datetime.fromisoformat(d), wb.add_format({**{"num_format": "dd.mm.yyyy"}, "bold": True, "bg_color": "#DDE7F3", "border": 1}))
            dly.set_column(1 + c, 1 + c, 11, f_num)

    if data:
        for r, row_ in enumerate(data["master"], start=1):
            sheets["Master Data"].write_row(r, 0, row_)
        for r, row_ in enumerate(data["presses"], start=1):
            sheets["Work Centers"].write_row(r, 0, row_)
        for r, (shift, name, kind, start, dur) in enumerate(data["stops"], start=1):
            ws = sheets["Planned Stops"]
            ws.write_row(r, 0, [shift, name, kind])
            h, m = start.split(":")
            ws.write_datetime(r, 3, dt.time(int(h), int(m)), f_time)
            ws.write(r, 4, dur)
        for r, (d, name) in enumerate(data["holidays"], start=1):
            sheets["Holidays"].write_datetime(r, 0, dt.datetime.fromisoformat(d), f_date)
            sheets["Holidays"].write(r, 1, name)
        for r, (press, d, n) in enumerate(data["dayShifts"], start=1):
            ws = sheets["Day Shifts"]
            ws.write(r, 0, press)
            ws.write_datetime(r, 1, dt.datetime.fromisoformat(d), f_date)
            ws.write(r, 2, n)
        for r, row_ in enumerate(data["locations"], start=1):
            sheets["Storage Locations"].write_row(r, 0, row_)
        for r, row_ in enumerate(data["stock"], start=1):
            sheets["MB52"].write_row(r, 0, row_)
        for r, row_ in enumerate(data["zpp"], start=1):
            zpp.write_row(r, 0, row_)
        for r, row_ in enumerate(data["daily"], start=1):
            sheets["ZPP_DAILY"].write_row(r, 0, row_)
    wb.close()


def main() -> None:
    defaults = code_defaults()
    if len(sys.argv) >= 4 and sys.argv[1] == "--stress":
        # python3 build_excel.py --stress SEED OUT.xlsm [LOAD]  (test data + OUT.json)
        source = (HERE / "PlanEngine.bas").read_text(encoding="utf-8")
        modules = [("ThisWorkbook", document_module("ThisWorkbook", True), True)]
        modules += [(f"Sheet{i}", document_module(f"Sheet{i}", False), True) for i in range(1, len(SHEETS) + 1)]
        modules.append(("PlanEngine", source, False))
        data = stress_example(int(sys.argv[2]), float(sys.argv[4]) if len(sys.argv) > 4 else 1.0)
        out = Path(sys.argv[3])
        build(out, data, defaults, build_vba_project(modules))
        out.with_suffix(".json").write_text(json.dumps(data), encoding="utf-8")
        return
    source = (HERE / "PlanEngine.bas").read_text(encoding="utf-8")
    modules = [("ThisWorkbook", document_module("ThisWorkbook", True), True)]
    modules += [(f"Sheet{i}", document_module(f"Sheet{i}", False), True) for i in range(1, len(SHEETS) + 1)]
    modules.append(("PlanEngine", source, False))
    vba_bin = build_vba_project(modules)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build(OUT_DIR / "PlanningExpert_Planlama.xlsm", None, defaults, vba_bin)
    data = example()
    build(OUT_DIR / "PlanningExpert_Planlama_Ornek.xlsm", data, defaults, vba_bin)
    (HERE / "example.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
    # the same VBA source next to the workbooks: fallback if Excel does not load the macros
    (OUT_DIR / "PlanEngine.bas").write_text(source.replace("\r\n", "\n").replace("\n", "\r\n"), encoding="cp1252", newline="")
    print("written:", *(p.name for p in sorted(OUT_DIR.glob("*.xlsm"))))


if __name__ == "__main__":
    main()
