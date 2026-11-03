"""Runs the workbook's RunPlanQuiet macro in headless LibreOffice and saves the
result as .xlsx (test helper; run with the system python that has `uno`).

    /usr/bin/python3 tools/excel/run_in_libreoffice.py IN.xlsm OUT.xlsx
"""
import os
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def main(src: str, dst: str) -> None:
    port = 2002 + os.getpid() % 1000
    profile = f"file:///tmp/lo_profile_{os.getpid()}"
    proc = subprocess.Popen([
        "soffice", "--headless", "--invisible", "--norestore", "--nologo",
        f"-env:UserInstallation={profile}",
        f"--accept=socket,host=127.0.0.1,port={port};urp;",
    ], stdout=subprocess.DEVNULL, stderr=open(os.environ.get("LO_LOG", os.devnull), "w"))
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        ctx = None
        for _ in range(60):
            try:
                ctx = resolver.resolve(f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext")
                break
            except Exception:
                time.sleep(0.5)
        if ctx is None:
            raise SystemExit("LibreOffice did not start")
        desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
        url = uno.systemPathToFileUrl(os.path.abspath(src))
        doc = desktop.loadComponentFromURL(url, "_blank", 0, (prop("Hidden", False), prop("MacroExecutionMode", 4)))
        script = doc.getScriptProvider().getScript(
            f"vnd.sun.star.script:VBAProject.PlanEngine.{os.environ.get('LO_MACRO', 'RunPlanQuiet')}?language=Basic&location=document")
        t0 = time.time()
        script.invoke((), (), ())
        print(f"macro ran in {time.time() - t0:.1f} s")
        out = uno.systemPathToFileUrl(os.path.abspath(dst))
        doc.storeToURL(out, (prop("FilterName", "Calc MS Excel 2007 XML"),))
        doc.close(True)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
