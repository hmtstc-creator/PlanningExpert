"""Production Plan + Unplanned of a result workbook as JSON (for engine-compare.test.ts)."""
import datetime as dt
import json
import sys

import openpyxl


def stamp(v):
    # nearest minute (the website side rounds the same way)
    return (v + dt.timedelta(seconds=30)).strftime("%Y-%m-%d %H:%M") if hasattr(v, "strftime") else str(v)


wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
jobs = []
for r in wb["Production Plan"].iter_rows(min_row=2, values_only=True):
    if r[0] is None:
        continue
    jobs.append({
        "press": str(r[1]), "material": str(r[3]), "bucket": str(r[4]), "qty": r[6],
        "setupStart": stamp(r[8]), "end": stamp(r[12]), "setupMinutes": r[9], "late": r[17] == "LATE",
    })
late_hours = round(sum((r[18] or 0) for r in wb["Production Plan"].iter_rows(min_row=2, values_only=True) if r[0] is not None and r[17] == "LATE"), 1)
unplanned = [list(r) for r in wb["Unplanned"].iter_rows(min_row=2, values_only=True) if r[0] is not None]
check = [list(r[:3]) for r in wb["Check"].iter_rows(min_row=1, values_only=True)]
print(json.dumps({"jobs": jobs, "lateHours": late_hours, "unplanned": [[str(x) for x in u] for u in unplanned], "check": [[str(x) for x in c] for c in check]}, indent=1))
