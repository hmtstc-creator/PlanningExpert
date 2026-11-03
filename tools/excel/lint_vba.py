"""Static checks the VBA compiler in Excel enforces but LibreOffice does not:
duplicate declarations in one procedure and assignments to undeclared names
(Option Explicit). Exit code 1 on any finding.   python3 tools/excel/lint_vba.py
"""
import re
import sys
from pathlib import Path

src = (Path(__file__).parent / "PlanEngine.bas").read_text(encoding="utf-8")
lines = src.replace("\r\n", "\n").split("\n")
# join continuation lines
joined = []
buf = ""
for ln in lines:
    code = re.sub(r"'.*$", "", ln) if '"' not in ln else ln
    if code.rstrip().endswith(" _"):
        buf += code.rstrip()[:-1] + " "
        continue
    joined.append(buf + ln)
    buf = ""

decl_re = re.compile(r"^\s*(?:Dim|Private|Public|Const|Static)\s+(?!Sub|Function|Type)(.+)$", re.I)
proc_re = re.compile(r"^\s*(?:Private |Public )?(Sub|Function)\s+(\w+)\s*\((.*)\)", re.I)
end_re = re.compile(r"^\s*End (Sub|Function)\b", re.I)
type_re = re.compile(r"^\s*(?:Private |Public )?Type\s+(\w+)", re.I)


def names_of(decl: str) -> list[str]:
    decl = re.sub(r"'.*$", "", decl)
    decl = re.sub(r"\([^()]*\)", "()", decl)
    out = []
    for part in decl.split(","):
        m = re.match(r"\s*(?:ByVal |ByRef |Optional )*(\w+)", part)
        if m:
            out.append(m.group(1).lower())
    return out


module_names = set()
procs = {}
in_proc = None
in_type = False
problems = []
for i, ln in enumerate(joined, 1):
    if type_re.match(ln) and not proc_re.match(ln):
        in_type = True
        module_names.add(type_re.match(ln).group(1).lower())
        continue
    if in_type:
        if re.match(r"^\s*End Type", ln, re.I):
            in_type = False
        continue
    m = proc_re.match(ln)
    if m:
        in_proc = m.group(2)
        module_names.add(in_proc.lower())
        procs[in_proc] = {"params": names_of(m.group(3)), "dims": [], "lines": []}
        continue
    if end_re.match(ln):
        in_proc = None
        continue
    d = decl_re.match(ln)
    if in_proc is None:
        if d:
            module_names.update(names_of(d.group(1).replace("Const ", "")))
        continue
    procs[in_proc]["lines"].append((i, ln))
    if d and re.match(r"^\s*Dim\b", ln, re.I):
        procs[in_proc]["dims"] += names_of(d.group(1))

for name, p in procs.items():
    seen = set(p["params"])
    for n in p["dims"]:
        if n in seen:
            problems.append(f"{name}: duplicate declaration of {n}")
        seen.add(n)
    known = seen | module_names | {name.lower()}
    for i, ln in p["lines"]:
        code = re.sub(r"'.*$", "", ln) if '"' not in ln else ln
        for stmt in code.split(":"):
            m = re.match(r"^\s*(?:For\s+)?(\w+)(?:\([^=]*\))?\s*=", stmt) or re.match(r"^\s*(?:If .* Then\s+)(\w+)(?:\([^=]*\))?\s*=", stmt)
            if not m:
                continue
            word = m.group(1).lower()
            if word in ("if", "elseif", "do", "loop", "while", "select", "case", "set", "let", "next", "with"):
                continue
            if word not in known:
                problems.append(f"{name} line {i}: assignment to undeclared {m.group(1)}")
for p in problems:
    print(p)
print(f"{len(procs)} procedures checked, {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
