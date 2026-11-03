Attribute VB_Name = "PlanEngine"
' ============================================================================
' PlanningExpert - Excel planning module (core engine)
'
' A VBA port of the core of the PlanningExpert planning engine:
'   src/lib/planning.ts   buildDemandSchedule (demand -> lots)
'   src/lib/scheduler.ts  schedule / placeRun / tryPlaceOnPress / reserveSlot
'   src/lib/planPipeline.ts  delivery deadline + late-job repair (boost rounds)
' The rules not ported are listed on the "Start" sheet (scope).
' Do not edit by hand in Excel: the source lives in tools/excel/PlanEngine.bas
' in the repository and the workbook is rebuilt from it.
' ============================================================================
Option Explicit

Private Const EPS As Double = 0.000001
Private Const K_SETUP As Long = 1
Private Const K_QUALITY As Long = 2
Private Const K_RUN As Long = 3
Private Const K_COIL As Long = 4
Private Const PH_BACKLOG As Long = 0
Private Const PH_URGENT As Long = 1
Private Const PH_FILL As Long = 2
Private Const DAY_OPEN As Double = -1000000#
Private Const DAY_CLOSE As Double = 1000000#
Private Const MAX_SHIFTS As Long = 6

Private Type TProd
    code As String
    pname As String
    main As String
    alt1 As String
    alt2 As String
    alt3 As String
    alt4 As String
    flex As Boolean
    cycle As Double
    spm As Double
    cav As Double
    gross As Double
    coilKg As Double
    minLot As Double
    setup As Double
    coilMin As Double
    qa As Double
    perf As Double
    maxShots As Double
    coProd As String
End Type

Private Type TPress
    pname As String
    hall As String
    feeds As Boolean
    wdays As Long
    shifts As Long
    dayFirst As Long
    dayN As Long
    total As Double
    bkN As Long
End Type

Private Type TLot
    mat As String
    qty As Double
    due As Long
    earliest As Long
    bucket As String
    phase As Long
    urgency As Double
    lt As Boolean
    needF As Double
    noSO As Boolean
    cpFirst As Long
    cpN As Long
    boost As Boolean
    dlDate As Long
    dlNet As Double
    seq As Long
    rule As String
End Type

Private Type TJob
    mat As String
    press As Long
    lot As Long
    qty As Double
    setupMin As Double
    qaMin As Double
    runMin As Double
    coils As Long
    segFirst As Long
    segN As Long
    preFirst As Long
    preN As Long
    late As Boolean
    readyDate As Long
    readyMin As Double
    dlDate As Long
    dlNet As Double
    lateMin As Double
    urgentSetup As Boolean
    continued As Boolean
    reason As String
    allowed As Long
    seq As Long
End Type

Private Type TUnpl
    mat As String
    qty As Double
    phase As Long
    due As Long
    reason As String
    lt As Boolean
    bucket As String
End Type

' ---- settings ---------------------------------------------------------------
Private gPlanDate As Long
Private gBase As Long
Private gH As Long
Private gShiftMin As Double
Private gShiftStart As Double
Private gSafety As Long
Private gCapF As Double
Private gCutoff As Double
Private gPull As Long
Private gSetupGap As Double
Private gCoilGap As Double
Private gHallConc As Long
Private gCapNormal As Double
Private gCapUrgent As Double
Private gCross As Boolean
Private gRounds As Long
Private gFullNet As Double
Private gShiftNet(1 To MAX_SHIFTS) As Double
Private gMaxShifts As Long

' ---- planned stops & day timelines (by number of shifts 0..MAX) --------------
Private gStopN As Long
Private gStopShift() As Long
Private gStopStart() As Double
Private gStopDur() As Double
Private gStopThrough() As Boolean
Private tlSegS(0 To MAX_SHIFTS, 1 To 64) As Double
Private tlSegE(0 To MAX_SHIFTS, 1 To 64) As Double
Private tlSegN(0 To MAX_SHIFTS) As Long
Private tlNet(0 To MAX_SHIFTS) As Double
Private brAt(0 To MAX_SHIFTS, 1 To 64) As Double
Private brMin(0 To MAX_SHIFTS, 1 To 64) As Double
Private brN(0 To MAX_SHIFTS) As Long

' ---- master data -------------------------------------------------------------
Private gP() As TProd
Private gPN As Long
Private gProdIdx As Collection
Private gW() As TPress
Private gWN As Long
Private gPressIdx As Collection
Private gHolN As Long
Private gHol() As Long
Private gDsN As Long
Private gDsPress() As String
Private gDsDate() As Long
Private gDsShifts() As Long

' ---- press days -----------------------------------------------------------------
Private dyDate() As Long
Private dyOff() As Double
Private dyCap() As Double
Private dyStartNet() As Double
Private dyShifts() As Long
Private dyN As Long

' ---- demand ---------------------------------------------------------------------
Private gMatN As Long
Private gMat() As String
Private gMatIdx As Collection
Private gOverdue() As Double
Private gWeekly() As Double
Private gStock() As Double
Private gHasDaily() As Boolean
Private gDlyN As Long
Private gDlyMat() As Long
Private gDlyDate() As Long
Private gDlyQty() As Double
Private gDailyUntil As Long
Private gWeekLabel() As String

' ---- lots -------------------------------------------------------------------------
Private gLot() As TLot
Private gLotN As Long
Private cpDate() As Long
Private cpFrac() As Double
Private cpDl() As Long
Private cpDlNet() As Double
Private cpN As Long
Private gBaseLot() As TLot
Private gBaseLotN As Long
Private gBaseCpN As Long

' ---- schedule state ---------------------------------------------------------------
Private bS() As Double
Private bE() As Double
Private bMat() As String
Private bNoSetup() As Boolean
Private bSetupIf() As Double
Private bEarliest() As Double
Private bAdded() As Double
Private bLT() As Boolean
Private bJob() As Long
Private bN As Long
Private bkIdx() As Long
Private bkCap As Long
Private hlHall() As String
Private hlType() As Long
Private hlDate() As Long
Private hlS() As Double
Private hlE() As Double
Private hlPress() As String
Private hlN As Long
Private muMat() As String
Private muDate() As Long
Private muPress() As Long
Private muS() As Double
Private muE() As Double
Private muN As Long
Private muNext() As Long
Private muHead() As Long
Private muTail() As Long
Private hlNext() As Long
Private hlHead() As Long
Private cntCache() As Long
Private gJob() As TJob
Private gJobN As Long
Private sgKind() As Long
Private sgDate() As Long
Private sgS() As Double
Private sgE() As Double
Private sgN As Long
Private gUn() As TUnpl
Private gUnN As Long
Private gStep As Long

' temp segments of the attempt being built
Private tKind() As Long
Private tDate() As Long
Private tS() As Double
Private tE() As Double
Private tN As Long

Private gWarn As Collection
Private gStage As String

' =====================================================================================
' Public macros (buttons)
' =====================================================================================
Public Sub RunPlan()
    DoRun False
End Sub

' Same as RunPlan without message boxes (used by the automated test).
Public Sub RunPlanQuiet()
    DoRun True
End Sub

Private Sub DoRun(ByVal quiet As Boolean)
    Dim t0 As Double
    t0 = Timer
    On Error GoTo Fail
    AppFast True
    Set gWarn = New Collection
    Status "reading inputs"
    gStage = "Settings": LoadSettings
    gStage = "Planned Stops": LoadStops
    gStage = "Master Data": LoadMaster
    gStage = "Work Centers": LoadPresses
    gStage = "Holidays / Day Shifts": LoadCalendar
    gStage = "work center calendar": BuildPressDays
    gStage = "ZPP / ZPP_DAILY / MB52": LoadDemand
    gStage = "demand -> lots": BuildLots
    SaveBaseLots
    Status "planning (round 1)"
    gStage = "scheduling": RepairAndSchedule
    Status "writing results"
    gStage = "writing results": WriteOutputs Timer - t0
    Status ""
    AppFast False
    If quiet Then Exit Sub
    ThisWorkbook.Worksheets("Production Plan").Activate
    MsgBox "Plan ready: " & gJobN & " jobs, " & CountLate() & " late, " & gUnN & " unplanned." & vbCrLf & _
           "See the Check sheet before using the plan.", vbInformation, "PlanningExpert"
    Exit Sub
Fail:
    Dim msg As String
    msg = Err.Description & " (error " & Err.Number & ", step: " & gStage & ")"
    AppFast False
    Status ""
    If quiet Then
        Sh("Check").Cells(1, 4).Value = "ERROR: " & msg
        Exit Sub
    End If
    MsgBox "Planning stopped: " & msg, vbCritical, "PlanningExpert"
End Sub

' Progress text in Excel's status bar (ignored where not available).
Private Sub Status(ByVal text As String)
    On Error Resume Next
    If text = "" Then Application.StatusBar = False Else Application.StatusBar = "PlanningExpert: " & text
End Sub

' Screen updating / manual calculation while planning (ignored where not available).
Private Sub AppFast(ByVal fast As Boolean)
    On Error Resume Next
    Application.ScreenUpdating = Not fast
    If fast Then Application.Calculation = -4135 Else Application.Calculation = -4105
End Sub

Public Sub ClearOutputs()
    Dim names As Variant, i As Long
    names = Array("Lots", "Production Plan", "Unplanned", "Load", "Check")
    For i = LBound(names) To UBound(names)
        ClearSheet CStr(names(i))
    Next i
    MsgBox "Output sheets cleared.", vbInformation, "PlanningExpert"
End Sub

Public Sub CheckData()
    On Error GoTo Fail
    Set gWarn = New Collection
    LoadSettings
    LoadStops
    LoadMaster
    LoadPresses
    LoadCalendar
    BuildPressDays
    LoadDemand
    gJobN = 0: gUnN = 0: gLotN = 0
    WriteCheck True
    ThisWorkbook.Worksheets("Check").Activate
    MsgBox "Data check written to the Check sheet.", vbInformation, "PlanningExpert"
    Exit Sub
Fail:
    MsgBox "Data check stopped: " & Err.Description, vbCritical, "PlanningExpert"
End Sub

' =====================================================================================
' Reading helpers
' =====================================================================================
Private Function Sh(ByVal sheetName As String) As Object
    Set Sh = ThisWorkbook.Worksheets(sheetName)
End Function

' Data block of an input sheet: rows below the header row (row 1), as a 2D array.
Private Function ReadTable(ByVal sheetName As String, ByVal nCols As Long, ByRef nRows As Long) As Variant
    Dim ws As Object, lastRow As Long, r As Long, c As Long, v As Variant, data As Variant
    Set ws = Sh(sheetName)
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row ' xlUp
    nRows = 0
    If lastRow < 2 Then
        ReadTable = Empty
        Exit Function
    End If
    data = ws.Range(ws.Cells(2, 1), ws.Cells(lastRow, nCols)).Value
    ' drop rows with an empty first column
    Dim outArr() As Variant, k As Long
    ReDim outArr(1 To lastRow - 1, 1 To nCols)
    For r = 1 To lastRow - 1
        v = data(r, 1)
        If Trim$(CStr(v)) <> "" Then
            k = k + 1
            For c = 1 To nCols
                outArr(k, c) = data(r, c)
            Next c
        End If
    Next r
    nRows = k
    ReadTable = outArr
End Function

Private Function Num(ByVal v As Variant) As Double
    If IsEmpty(v) Then Num = 0: Exit Function
    If IsNumeric(v) Then Num = CDbl(v): Exit Function
    Dim s As String
    s = Trim$(CStr(v))
    If s = "" Then Num = 0: Exit Function
    s = Replace(s, ",", ".")
    If IsNumeric(s) Then
        Num = Val(s)
    Else
        Num = 0
    End If
End Function

Private Function Txt(ByVal v As Variant) As String
    If IsEmpty(v) Then Txt = "": Exit Function
    If IsError(v) Then Txt = "": Exit Function
    If VarType(v) = vbDouble Or VarType(v) = vbCurrency Or VarType(v) = vbSingle Then
        If v = Int(v) And Abs(v) < 1E+15 Then Txt = Format$(v, "0"): Exit Function
    End If
    Txt = Trim$(CStr(v))
End Function

Private Function YesNo(ByVal v As Variant, ByVal dflt As Boolean) As Boolean
    Dim s As String
    s = UCase$(Txt(v))
    If s = "" Then YesNo = dflt: Exit Function
    YesNo = (s = "Y" Or s = "YES" Or s = "E" Or s = "EVET" Or s = "1" Or s = "TRUE" Or s = "X")
End Function

' A time of day as minutes after midnight: Excel time (0..1), "07:00", or minutes.
Private Function ClockMin(ByVal v As Variant) As Double
    Dim s As String, p As Long
    If IsDate(v) And Not IsNumeric(v) Then
        ClockMin = Hour(v) * 60 + Minute(v)
        Exit Function
    End If
    If IsNumeric(v) Then
        If CDbl(v) < 1 And CDbl(v) >= 0 Then
            ClockMin = Round(CDbl(v) * 1440, 0)
        Else
            ClockMin = CDbl(v)
        End If
        Exit Function
    End If
    s = Trim$(CStr(v))
    p = InStr(s, ":")
    If p > 0 Then
        ClockMin = Val(Left$(s, p - 1)) * 60 + Val(Mid$(s, p + 1))
    Else
        ClockMin = Num(s)
    End If
End Function

' A date cell or header: Excel date, "2026-11-03", "03.11.2026", "03/11/2026".
Private Function DateOf(ByVal v As Variant) As Long
    Dim s As String, parts() As String
    DateOf = 0
    If IsEmpty(v) Then Exit Function
    If VarType(v) = vbDate Then DateOf = CLng(Int(CDbl(v))): Exit Function
    If IsNumeric(v) Then
        If CDbl(v) > 20000 And CDbl(v) < 80000 Then DateOf = CLng(Int(CDbl(v)))
        Exit Function
    End If
    s = Trim$(CStr(v))
    If Len(s) >= 10 And Mid$(s, 5, 1) = "-" Then
        DateOf = CLng(DateSerial(Val(Left$(s, 4)), Val(Mid$(s, 6, 2)), Val(Mid$(s, 9, 2))))
        Exit Function
    End If
    s = Replace(Replace(s, "/", "."), "-", ".")
    parts = Split(s, ".")
    If UBound(parts) = 2 Then
        If Val(parts(2)) > 1900 Then
            DateOf = CLng(DateSerial(Val(parts(2)), Val(parts(1)), Val(parts(0))))
        End If
    End If
End Function

Private Function MondayOf(ByVal d As Long) As Long
    MondayOf = d - (Weekday(d, vbMonday) - 1)
End Function

Private Function IsoTxt(ByVal d As Long) As String
    IsoTxt = Format$(DateSerial(Year(d), Month(d), Day(d)), "yyyy-mm-dd")
End Function

Private Sub Warn(ByVal msg As String)
    On Error Resume Next
    gWarn.Add msg
End Sub

Private Function SettingValue(ByVal label As String, ByVal dflt As Variant) As Variant
    Dim ws As Object, r As Long, lastRow As Long
    Set ws = Sh("Settings")
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
    For r = 2 To lastRow
        If LCase$(Trim$(CStr(ws.Cells(r, 1).Value))) = LCase$(label) Then
            If Trim$(CStr(ws.Cells(r, 2).Value)) = "" Then
                SettingValue = dflt
            Else
                SettingValue = ws.Cells(r, 2).Value
            End If
            Exit Function
        End If
    Next r
    SettingValue = dflt
End Function

Private Function ColIndex(ByRef keyCol As Collection, ByVal key As String) As Long
    On Error GoTo NotFound
    ColIndex = keyCol.Item("k" & key)
    Exit Function
NotFound:
    ColIndex = 0
End Function

' =====================================================================================
' Load inputs
' =====================================================================================
Private Sub LoadSettings()
    Dim v As Variant, i As Long
    v = SettingValue("Plan date", Date)
    gPlanDate = DateOf(v)
    If gPlanDate = 0 Then gPlanDate = CLng(Date)
    gBase = MondayOf(gPlanDate)
    gH = CLng(Num(SettingValue("Planning horizon (weeks)", 4)))
    If gH < 1 Then gH = 1
    If gH > 30 Then gH = 30
    gShiftMin = Num(SettingValue("Shift length (min)", 480))
    If gShiftMin <= 0 Then gShiftMin = 480
    gShiftStart = ClockMin(SettingValue("First shift start", 420))
    gSafety = CLng(Num(SettingValue("Safety stock (working days)", 2)))
    If gSafety < 0 Then gSafety = 0
    gCapF = Num(SettingValue("Capacity factor", 1))
    If gCapF <= 0 Then gCapF = 1
    gCutoff = ClockMin(SettingValue("Delivery cut-off time", 480))
    gPull = CLng(Num(SettingValue("Pull forward days (fill lots)", 10)))
    If gPull < 0 Then gPull = 0
    gSetupGap = Num(SettingValue("Setup gap in a hall (min)", 10))
    gCoilGap = Num(SettingValue("Coil change gap in a hall (min)", 30))
    gHallConc = CLng(Num(SettingValue("Concurrent setups per hall", 1)))
    If gHallConc < 1 Then gHallConc = 1
    gCapUrgent = Num(SettingValue("Max setups plant-wide (backlog / late)", 2))
    If gCapUrgent < 1 Then gCapUrgent = 1
    gCapNormal = Num(SettingValue("Max setups plant-wide (normal)", 1))
    If gCapNormal < 1 Then gCapNormal = 1
    If gCapNormal > gCapUrgent Then gCapNormal = gCapUrgent
    gCross = YesNo(SettingValue("Setups may cross shift change", "Y"), True)
    gRounds = CLng(Num(SettingValue("Late-job repair rounds", 6)))
    If gRounds < 0 Then gRounds = 0
    gMaxShifts = Int(1440 / gShiftMin)
    If gMaxShifts > MAX_SHIFTS Then gMaxShifts = MAX_SHIFTS
    If gMaxShifts < 1 Then gMaxShifts = 1
End Sub

Private Sub LoadStops()
    Dim data As Variant, n As Long, r As Long, i As Long, k As Long
    data = ReadTable("Planned Stops", 5, n)
    gStopN = 0
    ReDim gStopShift(1 To n + 1)
    ReDim gStopStart(1 To n + 1)
    ReDim gStopDur(1 To n + 1)
    ReDim gStopThrough(1 To n + 1)
    Dim kind As String
    For r = 1 To n
        If Num(data(r, 1)) >= 1 And Num(data(r, 5)) > 0 Then
            gStopN = gStopN + 1
            gStopShift(gStopN) = CLng(Num(data(r, 1)))
            gStopStart(gStopN) = ClockMin(data(r, 4))
            gStopDur(gStopN) = Num(data(r, 5))
            ' a die setup runs on through tea / meal / break (setup crew is indirect)
            kind = LCase$(Txt(data(r, 3)))
            gStopThrough(gStopN) = (kind = "tea" Or kind = "meal" Or kind = "break")
        End If
    Next r
    ' net minutes of each shift (motor: max(1, shift - stops of that shift))
    gFullNet = 0
    For i = 1 To MAX_SHIFTS
        Dim stopped As Double
        stopped = 0
        For k = 1 To gStopN
            If gStopShift(k) = i Then stopped = stopped + gStopDur(k)
        Next k
        gShiftNet(i) = gShiftMin - stopped
        If gShiftNet(i) < 1 Then gShiftNet(i) = 1
        If i <= 3 Then gFullNet = gFullNet + gShiftNet(i)
    Next i
    ' day timelines for 0..MAX shifts (shiftTimeline.buildDayTimeline)
    For i = 0 To MAX_SHIFTS
        BuildTimelineFor i
    Next i
End Sub

Private Sub BuildTimelineFor(ByVal n As Long)
    Dim i As Long, k As Long, ws As Double, we As Double
    Dim stS(1 To 64) As Double, stE(1 To 64) As Double, stT(1 To 64) As Boolean, stN As Long
    Dim tmpT As Boolean
    Dim cur As Double, j As Long, tmpS As Double, tmpE As Double
    tlSegN(n) = 0
    brN(n) = 0
    tlNet(n) = 0
    Dim allS(1 To 64) As Double, allE(1 To 64) As Double, allN As Long
    For i = 1 To n
        ws = gShiftStart + (i - 1) * gShiftMin
        we = ws + gShiftMin
        stN = 0
        For k = 1 To gStopN
            If gStopShift(k) = i Then
                Dim off As Long, s As Double
                For off = 0 To 2
                    s = gStopStart(k) + off * 1440
                    If s >= ws And s < we Then
                        stN = stN + 1
                        stS(stN) = s
                        stT(stN) = gStopThrough(k)
                        stE(stN) = s + gStopDur(k)
                        If stE(stN) > we Then stE(stN) = we
                        Exit For
                    End If
                Next off
            End If
        Next k
        ' sort stops of this shift
        For j = 1 To stN - 1
            For k = j + 1 To stN
                If stS(k) < stS(j) Then
                    tmpS = stS(j): stS(j) = stS(k): stS(k) = tmpS
                    tmpE = stE(j): stE(j) = stE(k): stE(k) = tmpE
                    tmpT = stT(j): stT(j) = stT(k): stT(k) = tmpT
                End If
            Next k
        Next j
        cur = ws
        For j = 1 To stN
            If stS(j) > cur Then
                tlSegN(n) = tlSegN(n) + 1
                tlSegS(n, tlSegN(n)) = cur
                tlSegE(n, tlSegN(n)) = IIf(stS(j) < we, stS(j), we)
            End If
            If stE(j) > cur Then cur = stE(j)
            If stT(j) Then
                allN = allN + 1
                allS(allN) = stS(j)
                allE(allN) = stE(j)
            End If
        Next j
        If cur < we Then
            tlSegN(n) = tlSegN(n) + 1
            tlSegS(n, tlSegN(n)) = cur
            tlSegE(n, tlSegN(n)) = we
        End If
    Next i
    For j = 1 To tlSegN(n)
        tlNet(n) = tlNet(n) + (tlSegE(n, j) - tlSegS(n, j))
    Next j
    ' setup breaks: stops at their net position (setup does not stop for breaks)
    For j = 1 To allN
        brN(n) = brN(n) + 1
        brAt(n, brN(n)) = ClockToNet(allS(j), n)
        brMin(n, brN(n)) = allE(j) - allS(j)
    Next j
    For j = 1 To brN(n) - 1
        For k = j + 1 To brN(n)
            If brAt(n, k) < brAt(n, j) Then
                tmpS = brAt(n, j): brAt(n, j) = brAt(n, k): brAt(n, k) = tmpS
                tmpE = brMin(n, j): brMin(n, j) = brMin(n, k): brMin(n, k) = tmpE
            End If
        Next k
    Next j
End Sub

Private Function ClockToNet(ByVal clock As Double, ByVal n As Long) As Double
    Dim j As Long, net As Double, e As Double
    For j = 1 To tlSegN(n)
        If clock <= tlSegS(n, j) Then Exit For
        e = tlSegE(n, j)
        If clock < e Then e = clock
        net = net + (e - tlSegS(n, j))
    Next j
    ClockToNet = net
End Function

' Net minute -> clock minute. atEnd: an end time sitting on a segment boundary
' belongs to the segment it closes (not the next one after a break).
Private Function NetToClock(ByVal net As Double, ByVal n As Long, ByVal atEnd As Boolean) As Double
    Dim j As Long, remaining As Double, length As Double
    remaining = net
    For j = 1 To tlSegN(n)
        length = tlSegE(n, j) - tlSegS(n, j)
        If remaining < length - EPS Or (atEnd And remaining <= length + EPS) Then
            NetToClock = tlSegS(n, j) + remaining
            Exit Function
        End If
        remaining = remaining - length
    Next j
    If tlSegN(n) > 0 Then
        NetToClock = tlSegE(n, tlSegN(n)) + remaining
    Else
        NetToClock = gShiftStart + remaining
    End If
End Function

Private Sub LoadMaster()
    Dim data As Variant, n As Long, r As Long, code As String
    data = ReadTable("Master Data", 21, n)
    gPN = 0
    ReDim gP(1 To n + 1)
    Set gProdIdx = New Collection
    For r = 1 To n
        code = Txt(data(r, 1))
        If code <> "" And ColIndex(gProdIdx, code) = 0 Then
            gPN = gPN + 1
            With gP(gPN)
                .code = code
                .pname = Txt(data(r, 2))
                .main = Txt(data(r, 3))
                .alt1 = Txt(data(r, 4))
                .alt2 = Txt(data(r, 5))
                .alt3 = Txt(data(r, 6))
                .alt4 = Txt(data(r, 7))
                .flex = YesNo(data(r, 8), False)
                .cycle = Num(data(r, 9))
                .spm = Num(data(r, 10))
                .cav = Num(data(r, 11))
                .gross = Num(data(r, 12))
                .coilKg = Num(data(r, 13))
                .minLot = Num(data(r, 14))
                .setup = Num(data(r, 15))
                .coilMin = Num(data(r, 16))
                .qa = Num(data(r, 17))
                .perf = Num(data(r, 18))
                .maxShots = Num(data(r, 19))
                .coProd = Txt(data(r, 20))
            End With
            gProdIdx.Add gPN, "k" & code
        ElseIf code <> "" Then
            Warn "Master Data: material " & code & " is listed twice - the first row is used."
        End If
    Next r
End Sub

Private Sub LoadPresses()
    Dim data As Variant, n As Long, r As Long, nm As String
    data = ReadTable("Work Centers", 5, n)
    gWN = 0
    ReDim gW(1 To n + 1)
    Set gPressIdx = New Collection
    For r = 1 To n
        nm = Txt(data(r, 1))
        If nm <> "" And ColIndex(gPressIdx, nm) = 0 Then
            gWN = gWN + 1
            With gW(gWN)
                .pname = nm
                .hall = Txt(data(r, 2))
                .feeds = YesNo(data(r, 3), True)
                .wdays = CLng(Num(data(r, 4)))
                If Txt(data(r, 4)) = "" Then .wdays = 5
                .shifts = CLng(Num(data(r, 5)))
                If Txt(data(r, 5)) = "" Then .shifts = 3
                If .wdays < 0 Then .wdays = 0
                If .wdays > 7 Then .wdays = 7
                If .shifts < 0 Then .shifts = 0
                If .shifts > gMaxShifts Then
                    Warn "Work Centers: " & nm & " has " & .shifts & " shifts/day; only " & gMaxShifts & " fit in 24 h - capped."
                    .shifts = gMaxShifts
                End If
            End With
            gPressIdx.Add gWN, "k" & nm
        End If
    Next r
End Sub

Private Sub LoadCalendar()
    Dim data As Variant, n As Long, r As Long, d As Long
    data = ReadTable("Holidays", 2, n)
    gHolN = 0
    ReDim gHol(1 To n + 1)
    For r = 1 To n
        d = DateOf(data(r, 1))
        If d > 0 Then gHolN = gHolN + 1: gHol(gHolN) = d
    Next r
    data = ReadTable("Day Shifts", 3, n)
    gDsN = 0
    ReDim gDsPress(1 To n + 1)
    ReDim gDsDate(1 To n + 1)
    ReDim gDsShifts(1 To n + 1)
    For r = 1 To n
        d = DateOf(data(r, 2))
        If d > 0 Then
            gDsN = gDsN + 1
            gDsPress(gDsN) = Txt(data(r, 1))
            gDsDate(gDsN) = d
            gDsShifts(gDsN) = CLng(Num(data(r, 3)))
            If gDsShifts(gDsN) > gMaxShifts Then gDsShifts(gDsN) = gMaxShifts
            If gDsShifts(gDsN) < 0 Then gDsShifts(gDsN) = 0
        End If
    Next r
End Sub

Private Function IsHoliday(ByVal d As Long) As Boolean
    Dim i As Long
    For i = 1 To gHolN
        If gHol(i) = d Then IsHoliday = True: Exit Function
    Next i
End Function

' Shifts of a work center on a date (pressCalendar.pressDay): day record >
' weekly template (first N days from Monday); a holiday removes the template day.
Private Function PressShifts(ByVal p As Long, ByVal d As Long) As Long
    Dim i As Long
    For i = gDsN To 1 Step -1
        If gDsDate(i) = d Then
            If gDsPress(i) = gW(p).pname Or gDsPress(i) = "*" Then
                PressShifts = gDsShifts(i)
                Exit Function
            End If
        End If
    Next i
    If IsHoliday(d) Then PressShifts = 0: Exit Function
    If Weekday(d, vbMonday) - 1 < gW(p).wdays Then
        PressShifts = gW(p).shifts
    Else
        PressShifts = 0
    End If
End Function

' Plant working date: not a holiday and at least one work center works.
Private Function IsWorkingDate(ByVal d As Long) As Boolean
    Dim p As Long
    If IsHoliday(d) Then Exit Function
    For p = 1 To gWN
        If PressShifts(p, d) > 0 Then IsWorkingDate = True: Exit Function
    Next p
End Function

Private Sub BuildPressDays()
    Dim p As Long, d As Long, n As Long, minutes As Double, off As Double
    dyN = 0
    ReDim dyDate(1 To gWN * gH * 7 + 1)
    ReDim dyOff(1 To gWN * gH * 7 + 1)
    ReDim dyCap(1 To gWN * gH * 7 + 1)
    ReDim dyStartNet(1 To gWN * gH * 7 + 1)
    ReDim dyShifts(1 To gWN * gH * 7 + 1)
    For p = 1 To gWN
        gW(p).dayFirst = dyN + 1
        off = 0
        For d = gBase To gBase + gH * 7 - 1
            If d >= gPlanDate Then
                n = PressShifts(p, d)
                minutes = tlNet(n)
                If gCapF <> 1 Then minutes = Int(minutes * gCapF)
                If minutes > 0 Then
                    dyN = dyN + 1
                    dyDate(dyN) = d
                    dyOff(dyN) = off
                    dyCap(dyN) = minutes
                    dyStartNet(dyN) = 0
                    dyShifts(dyN) = n
                    off = off + minutes
                End If
            End If
        Next d
        gW(p).dayN = dyN - gW(p).dayFirst + 1
        gW(p).total = off
    Next p
End Sub

Private Sub LoadDemand()
    Dim data As Variant, n As Long, r As Long, c As Long, ws As Object, lastCol As Long
    Dim m As String, i As Long, lastRow As Long, nWeekCols As Long
    Set gMatIdx = New Collection
    gMatN = 0
    ' ---- ZPP (weekly): Material | Overdue | week 1 (current week) | week 2 ...
    Set ws = Sh("ZPP")
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
    lastCol = ws.Cells(1, ws.Columns.Count).End(-4159).Column ' xlToLeft
    nWeekCols = lastCol - 2
    If nWeekCols < 0 Then nWeekCols = 0
    Dim zpp As Variant
    If lastRow >= 2 And lastCol >= 2 Then zpp = ws.Range(ws.Cells(1, 1), ws.Cells(lastRow, lastCol)).Value
    ' ---- ZPP_DAILY: Material | date columns
    Dim dws As Object, dLastRow As Long, dLastCol As Long, dly As Variant
    Set dws = Sh("ZPP_DAILY")
    dLastRow = dws.Cells(dws.Rows.Count, 1).End(-4162).Row
    dLastCol = dws.Cells(1, dws.Columns.Count).End(-4159).Column
    If dLastRow >= 2 And dLastCol >= 2 Then dly = dws.Range(dws.Cells(1, 1), dws.Cells(dLastRow, dLastCol)).Value
    Dim cap As Long
    cap = (lastRow + dLastRow + 2)
    ReDim gMat(1 To cap)
    ReDim gOverdue(1 To cap)
    ReDim gStock(1 To cap)
    ReDim gHasDaily(1 To cap)
    ReDim gWeekly(1 To cap, 0 To gH - 1)
    ReDim gWeekLabel(0 To gH - 1)
    For i = 0 To gH - 1
        gWeekLabel(i) = "+" & i & "w"
        If i < nWeekCols And Not IsEmpty(zpp) Then
            If Txt(zpp(1, i + 3)) <> "" Then gWeekLabel(i) = Txt(zpp(1, i + 3))
        End If
    Next i
    If Not IsEmpty(zpp) Then
        For r = 2 To lastRow
            m = Txt(zpp(r, 1))
            If m <> "" Then
                i = ColIndex(gMatIdx, m)
                If i = 0 Then
                    gMatN = gMatN + 1
                    i = gMatN
                    gMat(i) = m
                    gMatIdx.Add i, "k" & m
                Else
                    Warn "ZPP: material " & m & " is listed twice - quantities are added."
                End If
                gOverdue(i) = gOverdue(i) + Abs(Num(zpp(r, 2)))
                For c = 0 To gH - 1
                    If c < nWeekCols Then gWeekly(i, c) = gWeekly(i, c) + Abs(Num(zpp(r, c + 3)))
                Next c
            End If
        Next r
    End If
    ' daily rows
    gDlyN = 0
    gDailyUntil = 0
    Dim hdrDate() As Long
    If Not IsEmpty(dly) Then
        ReDim hdrDate(2 To dLastCol)
        For c = 2 To dLastCol
            hdrDate(c) = DateOf(dly(1, c))
        Next c
        ReDim gDlyMat(1 To (dLastRow) * (dLastCol) + 1)
        ReDim gDlyDate(1 To (dLastRow) * (dLastCol) + 1)
        ReDim gDlyQty(1 To (dLastRow) * (dLastCol) + 1)
        Dim anyRow As Boolean
        For r = 2 To dLastRow
            m = Txt(dly(r, 1))
            If m <> "" Then
                anyRow = True
                i = ColIndex(gMatIdx, m)
                If i = 0 Then
                    gMatN = gMatN + 1
                    i = gMatN
                    gMat(i) = m
                    gMatIdx.Add i, "k" & m
                End If
                gHasDaily(i) = True
                For c = 2 To dLastCol
                    If hdrDate(c) > 0 Then
                        If hdrDate(c) > gDailyUntil Then gDailyUntil = hdrDate(c)
                        If Abs(Num(dly(r, c))) > 0 Then
                            gDlyN = gDlyN + 1
                            gDlyMat(gDlyN) = i
                            gDlyDate(gDlyN) = hdrDate(c)
                            gDlyQty(gDlyN) = Abs(Num(dly(r, c)))
                        End If
                    End If
                Next c
            End If
        Next r
        If Not anyRow Then gDailyUntil = 0
    End If
    ' ---- MB52 stock: unrestricted, finished-goods storage locations only
    Dim loc As Variant, nLoc As Long, locs As New Collection, stockData As Variant, nStock As Long
    loc = ReadTable("Storage Locations", 2, nLoc)
    For r = 1 To nLoc
        If YesNo(loc(r, 2), False) Then
            On Error Resume Next
            locs.Add 1, "k" & Txt(loc(r, 1))
            On Error GoTo 0
        End If
    Next r
    If nLoc = 0 Then Warn "Storage Locations is empty: every MB52 row is counted as finished-goods stock."
    stockData = ReadTable("MB52", 4, nStock)
    For r = 1 To nStock
        m = Txt(stockData(r, 1))
        i = ColIndex(gMatIdx, m)
        If i > 0 Then
            Dim sl As String, counts As Boolean
            sl = Txt(stockData(r, 3))
            If nLoc = 0 Or sl = "" Then
                counts = True
            Else
                counts = (ColIndex(locs, sl) > 0)
            End If
            If counts Then gStock(i) = gStock(i) + Num(stockData(r, 4))
        End If
    Next r
End Sub

' =====================================================================================
' Product helpers (planning.ts / rateModel.ts)
' =====================================================================================
Private Function ProdOf(ByVal m As String) As Long
    ProdOf = ColIndex(gProdIdx, m)
End Function

Private Function CavOf(ByVal p As Long) As Double
    If p = 0 Then CavOf = 1: Exit Function
    If gP(p).cav > 0 Then CavOf = gP(p).cav Else CavOf = 1
End Function

Private Function PiecesPerCoil(ByVal p As Long) As Double
    If p = 0 Then Exit Function
    If gP(p).minLot > 0 Then PiecesPerCoil = 0: Exit Function
    If gP(p).gross <= 0 Or gP(p).coilKg <= 1 Then PiecesPerCoil = 0: Exit Function
    PiecesPerCoil = Int(gP(p).coilKg / gP(p).gross + 0.0000000001)
End Function

Private Function ShotsPerCoil(ByVal p As Long) As Double
    Dim pcs As Double
    pcs = PiecesPerCoil(p)
    If pcs <= 0 Then ShotsPerCoil = 0 Else ShotsPerCoil = Int(pcs / CavOf(p))
End Function

Private Function LotRule(ByVal p As Long) As String
    If p = 0 Then LotRule = "missing": Exit Function
    If gP(p).minLot > 0 Then LotRule = "min. lot": Exit Function
    If PiecesPerCoil(p) > 0 Then LotRule = "full coil" Else LotRule = "missing"
End Function

Private Function CeilD(ByVal x As Double) As Double
    Dim f As Double
    f = Int(x)
    If x - f > 0.0000000001 Then CeilD = f + 1 Else CeilD = f
End Function

Private Function MinutesPerPiece(ByVal p As Long) As Double
    If p = 0 Then Exit Function
    If gP(p).cycle > 0 Then MinutesPerPiece = gP(p).cycle: Exit Function
    If gP(p).spm > 0 Then MinutesPerPiece = 1 / (gP(p).spm * CavOf(p))
End Function

Private Function RunMinutesFor(ByVal p As Long, ByVal q As Double) As Double
    Dim strokes As Double
    If q <= 0 Then Exit Function
    strokes = CeilD(q / CavOf(p))
    If gP(p).cycle > 0 Then RunMinutesFor = strokes * CavOf(p) * gP(p).cycle: Exit Function
    If gP(p).spm > 0 Then RunMinutesFor = strokes / gP(p).spm
End Function

' Eligible work centers: main; alternatives only if flexible (eligiblePressesOf).
Private Function Eligible(ByVal p As Long) As Collection
    Dim c As New Collection, list As Variant, i As Long, nm As String, j As Long, dup As Boolean
    If p = 0 Then Set Eligible = c: Exit Function
    If gP(p).flex Then
        list = Array(gP(p).main, gP(p).alt1, gP(p).alt2, gP(p).alt3, gP(p).alt4)
    Else
        list = Array(gP(p).main)
    End If
    For i = LBound(list) To UBound(list)
        nm = Trim$(CStr(list(i)))
        If nm <> "" Then
            dup = False
            For j = 1 To c.Count
                If c.Item(j) = nm Then dup = True
            Next j
            If Not dup Then c.Add nm
        End If
    Next i
    Set Eligible = c
End Function

Private Function CountFor(ByVal m As String) As Long
    Dim c As Collection, i As Long, pix As Long
    pix = ProdOf(m)
    If cntCache(pix) >= 0 Then CountFor = cntCache(pix): Exit Function
    Set c = Eligible(pix)
    For i = 1 To c.Count
        If ColIndex(gPressIdx, CStr(c.Item(i))) > 0 Then CountFor = CountFor + 1
    Next i
    cntCache(pix) = CountFor
End Function

' computeRunPlan: returns array(qty, shots, coilsNeeded, coilChanges, coilChangeMin,
'   setup, qa, runMinutes, totalMinutes, coilRuns() )
Private Function RunPlanOf(ByVal p As Long, ByVal q As Double) As Variant
    Dim cav As Double, shots As Double, theo As Double, pic As Double, coils As Double
    Dim setup As Double, changes As Double, chMin As Double, qa As Double, nonProd As Double
    Dim f As Double, win As Double, runFromWin As Double, runM As Double
    Dim runs() As Double, nr As Long, lft As Double, chunk As Double
    cav = CavOf(p)
    shots = CeilD(q / cav)
    theo = RunMinutesFor(p, q)
    pic = PiecesPerCoil(p)
    If pic > 0 Then coils = CeilD(q / pic) Else coils = 0
    setup = gP(p).setup
    changes = coils - 1
    If changes < 0 Then changes = 0
    chMin = gP(p).coilMin
    qa = gP(p).qa
    nonProd = setup + chMin * changes + qa
    If gP(p).perf > 0 Then f = gP(p).perf Else f = 1
    If f > 1 Then f = 1
    If f < 1 Then win = theo / f Else win = theo + nonProd
    runFromWin = win - nonProd
    If runFromWin < theo Then runM = theo Else runM = runFromWin
    If pic > 0 And q > 0 Then
        lft = q
        Do While lft > 0
            If lft < pic Then chunk = lft Else chunk = pic
            nr = nr + 1
            ReDim Preserve runs(1 To nr)
            runs(nr) = runM * chunk / q
            lft = lft - chunk
        Loop
    Else
        nr = 1
        ReDim runs(1 To 1)
        runs(1) = runM
    End If
    RunPlanOf = Array(q, shots, coils, changes, chMin, setup, qa, runM, nonProd + runM, runs)
End Function

' splitByMoldLimit: quantities of the runs (each with its own setup).
Private Function SplitRuns(ByVal p As Long, ByVal q As Double) As Variant
    Dim cav As Double, maxQ As Double, unit As Double, chunkSize As Double, rem_ As Double
    Dim out() As Double, n As Long
    cav = CavOf(p)
    If gP(p).maxShots <= 0 Or q <= gP(p).maxShots * cav Then
        ReDim out(1 To 1)
        out(1) = q
        SplitRuns = out
        Exit Function
    End If
    maxQ = gP(p).maxShots * cav
    unit = ShotsPerCoil(p) * cav
    If unit > 0 Then
        chunkSize = Int(maxQ / unit) * unit
        If chunkSize < unit Then chunkSize = unit
    Else
        chunkSize = maxQ
    End If
    rem_ = q
    Do While rem_ > 0
        n = n + 1
        ReDim Preserve out(1 To n)
        If rem_ < chunkSize Then out(n) = rem_ Else out(n) = chunkSize
        rem_ = rem_ - out(n)
    Loop
    SplitRuns = out
End Function

' =====================================================================================
' Demand -> lots (planning.buildDemandSchedule, without co-products)
' =====================================================================================
Private Sub AddCp(ByVal d As Long, ByVal f As Double)
    cpN = cpN + 1
    If cpN > UBound(cpDate) Then
        ReDim Preserve cpDate(1 To cpN * 2)
        ReDim Preserve cpFrac(1 To cpN * 2)
        ReDim Preserve cpDl(1 To cpN * 2)
        ReDim Preserve cpDlNet(1 To cpN * 2)
    End If
    cpDate(cpN) = d
    cpFrac(cpN) = f
End Sub

Private Function NewLot() As Long
    gLotN = gLotN + 1
    If gLotN > UBound(gLot) Then
        ReDim Preserve gLot(1 To gLotN * 2)
    End If
    NewLot = gLotN
End Function

Private Sub BuildLots()
    Dim nDays As Long, m As Long, w As Long, d As Long, i As Long, j As Long, k As Long
    Dim ws As Long, we As Long, today As Long, longTermActive As Boolean
    nDays = gH * 7
    today = gPlanDate
    If today < gBase Then today = gBase
    longTermActive = (gDailyUntil > 0 And gDailyUntil >= today)
    ' working days and open days
    Dim working() As Boolean, isOpen() As Boolean
    ReDim working(0 To nDays - 1)
    ReDim isOpen(0 To nDays - 1)
    For d = 0 To nDays - 1
        working(d) = IsWorkingDate(gBase + d)
        isOpen(d) = working(d) And (gBase + d >= today)
    Next d
    Dim wpw As Long
    For d = 0 To 6
        If working(d) Then wpw = wpw + 1
    Next d
    If wpw = 0 Then wpw = 5
    ' per material day demand (gross) and long-term part
    Dim perDay() As Double, perLT() As Double
    ReDim perDay(1 To gMatN + 1, 0 To nDays - 1)
    ReDim perLT(1 To gMatN + 1, 0 To nDays - 1)
    Dim weekTotal() As Double, weekWeekly() As Double
    ReDim weekTotal(1 To gMatN + 1, 0 To gH - 1)
    ReDim weekWeekly(1 To gMatN + 1, 0 To gH - 1)
    Dim tIdx As Long
    tIdx = today - gBase
    For m = 1 To gMatN
        If gOverdue(m) > 0 Then perDay(m, tIdx) = gOverdue(m)
        For w = 0 To gH - 1
            ws = gBase + w * 7
            we = ws + 6
            Dim nOpen As Long, qty As Double, dailySum As Double, rest As Double
            nOpen = 0
            For d = ws To we
                If isOpen(d - gBase) Then nOpen = nOpen + 1
            Next d
            qty = gWeekly(m, w)
            If Not gHasDaily(m) Or gDailyUntil = 0 Or gDailyUntil < ws Then
                If qty > 0 Then SpreadWeek perDay, perLT, m, ws, we, 0, qty, nOpen, isOpen, tIdx
                weekTotal(m, w) = qty
                weekWeekly(m, w) = qty
            Else
                dailySum = 0
                For k = 1 To gDlyN
                    If gDlyMat(k) = m Then
                        If gDlyDate(k) >= ws And gDlyDate(k) <= we And gDlyDate(k) >= today Then
                            perDay(m, gDlyDate(k) - gBase) = perDay(m, gDlyDate(k) - gBase) + gDlyQty(k)
                            dailySum = dailySum + gDlyQty(k)
                        End If
                    End If
                Next k
                If gDailyUntil >= we Then
                    weekTotal(m, w) = dailySum
                    weekWeekly(m, w) = 0
                Else
                    rest = qty - dailySum
                    If rest < 0 Then rest = 0
                    Dim nUnc As Long
                    nUnc = 0
                    For d = ws To we
                        If isOpen(d - gBase) And d > gDailyUntil Then nUnc = nUnc + 1
                    Next d
                    If rest > 0 Then
                        If nUnc > 0 Then
                            SpreadWeek perDay, perLT, m, ws, we, gDailyUntil, rest, nUnc, isOpen, tIdx
                        Else
                            SpreadWeek perDay, perLT, m, ws, we, 0, rest, nOpen, isOpen, tIdx
                        End If
                    End If
                    weekTotal(m, w) = dailySum + rest
                    weekWeekly(m, w) = rest
                End If
            End If
            If Not longTermActive Then weekWeekly(m, w) = 0
        Next w
    Next m
    If Not longTermActive Then
        For m = 1 To gMatN
            For d = 0 To nDays - 1
                perLT(m, d) = 0
            Next d
        Next m
    End If
    ' entries
    gStage = "demand -> lots: lots"
    gLotN = 0
    ReDim gLot(1 To 16)
    cpN = 0
    ReDim cpDate(1 To 16)
    ReDim cpFrac(1 To 16)
    ReDim cpDl(1 To 16)
    ReDim cpDlNet(1 To 16)
    Dim matFirst() As Long, matLast() As Long, L As Long
    ReDim matFirst(1 To gMatN + 1)
    ReDim matLast(1 To gMatN + 1)
    Dim seq As Long
    For m = 1 To gMatN
        matFirst(m) = gLotN + 1
        If gOverdue(m) > 0 Then
            L = NewLot()
            seq = seq + 1
            With gLot(L)
                .mat = gMat(m): .qty = gOverdue(m): .due = gBase - 1: .earliest = gBase
                .bucket = "Backlog": .phase = PH_BACKLOG: .urgency = 100: .lt = False
                .cpFirst = 0: .cpN = 0: .boost = False: .seq = seq: .needF = 0: .noSO = False
            End With
        End If
        For w = 0 To gH - 1
            If weekTotal(m, w) > 0 Then
                Dim dueW As Long, dq As Double
                dueW = gBase + w * 7
                dq = weekTotal(m, w) - weekWeekly(m, w)
                If dq > 0.000000001 Then
                    L = NewLot()
                    seq = seq + 1
                    With gLot(L)
                        .mat = gMat(m): .qty = dq: .due = dueW: .earliest = dueW
                        .bucket = gWeekLabel(w): .phase = PH_FILL: .urgency = 0: .lt = False
                        .cpFirst = 0: .cpN = 0: .boost = False: .seq = seq: .needF = 0: .noSO = False
                    End With
                End If
                If weekWeekly(m, w) > 0.000000001 Then
                    Dim mixed As Boolean, aft As Long
                    mixed = (dq > 0.000000001)
                    If mixed And gDailyUntil > 0 Then aft = gDailyUntil + 1 Else aft = dueW
                    If aft < dueW Then aft = dueW
                    L = NewLot()
                    seq = seq + 1
                    With gLot(L)
                        .mat = gMat(m): .qty = weekWeekly(m, w): .due = aft: .earliest = aft
                        If mixed Then .bucket = gWeekLabel(w) & " LT" Else .bucket = gWeekLabel(w)
                        .phase = PH_FILL: .urgency = 0: .lt = True
                        .cpFirst = 0: .cpN = 0: .boost = False: .seq = seq: .needF = 0: .noSO = False
                    End With
                End If
            End If
        Next w
        matLast(m) = gLotN
        ' stock FIFO
        Dim stockLeft As Double, used As Double
        stockLeft = gStock(m)
        For L = matFirst(m) To matLast(m)
            If stockLeft <= 0 Then Exit For
            used = gLot(L).qty
            If stockLeft < used Then used = stockLeft
            gLot(L).qty = gLot(L).qty - used
            stockLeft = stockLeft - used
        Next L
    Next m
    ' rounding to full coil / min. lot, excess carried forward
    gStage = "demand -> lots: rounding"
    For m = 1 To gMatN
        RoundMaterial m, matFirst(m), matLast(m)
    Next m
    ' timing by projected stock
    gStage = "demand -> lots: timing"
    TimeLots perDay, perLT, matFirst, matLast, working, isOpen, today, longTermActive
    ' drop empty lots, sort: long-term last, phase, due date, urgency
    gStage = "demand -> lots: sorting"
    Dim keep() As TLot, nk As Long
    ReDim keep(1 To gLotN + 1)
    For L = 1 To gLotN
        If gLot(L).qty > 0 Then
            nk = nk + 1
            CopyLot keep(nk), gLot(L)
            keep(nk).rule = LotRule(ProdOf(keep(nk).mat))
        End If
    Next L
    gLotN = nk
    ReDim gLot(1 To nk + 1)
    For L = 1 To nk
        CopyLot gLot(L), keep(L)
    Next L
    SortLots 1
    ' delivery deadlines
    gStage = "demand -> lots: deadlines"
    For L = 1 To gLotN
        DeadlineOf gLot(L).due, gLot(L).dlDate, gLot(L).dlNet
        For k = gLot(L).cpFirst To gLot(L).cpFirst + gLot(L).cpN - 1
            DeadlineOf cpDate(k), cpDl(k), cpDlNet(k)
        Next k
    Next L
End Sub

Private Sub SpreadWeek(ByRef perDay() As Double, ByRef perLT() As Double, ByVal m As Long, ByVal ws As Long, _
                       ByVal we As Long, ByVal after As Long, ByVal qty As Double, ByVal nDaysUsed As Long, _
                       ByRef isOpen() As Boolean, ByVal tIdx As Long)
    Dim d As Long
    If nDaysUsed = 0 Then
        perDay(m, tIdx) = perDay(m, tIdx) + qty
        perLT(m, tIdx) = perLT(m, tIdx) + qty
        Exit Sub
    End If
    For d = ws To we
        If isOpen(d - gBase) And (after = 0 Or d > after) Then
            perDay(m, d - gBase) = perDay(m, d - gBase) + qty / nDaysUsed
            perLT(m, d - gBase) = perLT(m, d - gBase) + qty / nDaysUsed
        End If
    Next d
End Sub

Private Sub RoundMaterial(ByVal m As Long, ByVal f As Long, ByVal t As Long)
    Dim p As Long, lotShots As Double, minShots As Double, cav As Double
    Dim weeks() As Long, nw As Long, L As Long, i As Long, j As Long, found As Boolean, tmp As Long
    Dim carry As Double, ownQty As Double, need As Double, shots As Double, produced As Double, first As Long
    If t < f Then Exit Sub
    p = ProdOf(gMat(m))
    If p = 0 Then Exit Sub
    lotShots = ShotsPerCoil(p)
    cav = CavOf(p)
    If gP(p).minLot > 0 Then minShots = CeilD(gP(p).minLot / cav)
    If lotShots <= 0 And minShots <= 0 Then Exit Sub
    ReDim weeks(1 To t - f + 1)
    For L = f To t
        found = False
        For i = 1 To nw
            If weeks(i) = gLot(L).due Then found = True
        Next i
        If Not found Then nw = nw + 1: weeks(nw) = gLot(L).due
    Next L
    For i = 1 To nw - 1
        For j = i + 1 To nw
            If weeks(j) < weeks(i) Then tmp = weeks(i): weeks(i) = weeks(j): weeks(j) = tmp
        Next j
    Next i
    carry = 0
    For i = 1 To nw
        ownQty = 0
        first = 0
        For L = f To t
            If gLot(L).due = weeks(i) Then
                ownQty = ownQty + gLot(L).qty
                If first = 0 Then first = L
            End If
        Next L
        need = ownQty - carry
        If need < 0 Then need = 0
        shots = CeilD(need / cav)
        If shots <= 0 Then
            shots = 0
        ElseIf lotShots > 0 Then
            shots = CeilD(shots / lotShots) * lotShots
        ElseIf shots < minShots Then
            shots = minShots
        End If
        produced = shots * cav
        carry = carry + produced - ownQty
        For L = f To t
            If gLot(L).due = weeks(i) Then
                If L = first Then gLot(L).qty = produced Else gLot(L).qty = 0
            End If
        Next L
    Next i
End Sub

Private Sub TimeLots(ByRef perDay() As Double, ByRef perLT() As Double, ByRef matFirst() As Long, ByRef matLast() As Long, _
                     ByRef working() As Boolean, ByRef isOpen() As Boolean, ByVal today As Long, ByVal longTermActive As Boolean)
    Dim nDays As Long, d As Long, m As Long, i As Long, L As Long, k As Long
    nDays = gH * 7
    ' days on which demand is consumed: today + open days + any demand day >= today
    Dim inSet() As Boolean, days() As Long, nd As Long, cnt() As Boolean, dayPos() As Long
    ReDim inSet(0 To nDays - 1)
    ReDim dayPos(0 To nDays - 1)
    inSet(today - gBase) = True
    For d = 0 To nDays - 1
        If isOpen(d) Then inSet(d) = True
    Next d
    For m = 1 To gMatN
        For d = today - gBase To nDays - 1
            If perDay(m, d) <> 0 Then inSet(d) = True
        Next d
    Next m
    ReDim days(0 To nDays)
    ReDim cnt(0 To nDays)
    nd = 0
    For d = 0 To nDays - 1
        dayPos(d) = -1
        If inSet(d) Then
            days(nd) = gBase + d
            cnt(nd) = (nd = 0) Or working(d)
            dayPos(d) = nd
            nd = nd + 1
        End If
    Next d
    Dim demand() As Double, dailyD() As Double
    For m = 1 To gMatN
        If matLast(m) >= matFirst(m) Then
            ReDim demand(0 To nd - 1)
            ReDim dailyD(0 To nd - 1)
            For d = 0 To nDays - 1
                If perDay(m, d) <> 0 Then
                    Dim pos As Long
                    If gBase + d < today Then pos = 0 Else pos = dayPos(d)
                    If pos < 0 Then pos = 0
                    demand(pos) = demand(pos) + perDay(m, d)
                End If
            Next d
            For i = 0 To nd - 1
                dailyD(i) = demand(i)
            Next i
            Dim hasLT As Boolean
            hasLT = longTermActive
            If hasLT Then
                For d = 0 To nDays - 1
                    If perLT(m, d) <> 0 Then
                        If gBase + d < today Then pos = 0 Else pos = dayPos(d)
                        If pos < 0 Then pos = 0
                        dailyD(pos) = dailyD(pos) - perLT(m, d)
                    End If
                Next d
            End If
            ' lots of this material sorted by due date (stable)
            Dim order() As Long, no As Long, a As Long, b As Long, tmp As Long
            ReDim order(1 To matLast(m) - matFirst(m) + 1)
            no = 0
            For L = matFirst(m) To matLast(m)
                If gLot(L).qty > 0 Then no = no + 1: order(no) = L
            Next L
            For a = 2 To no
                tmp = order(a)
                b = a - 1
                Do While b >= 1
                    If gLot(order(b)).due > gLot(tmp).due Then
                        order(b + 1) = order(b)
                        b = b - 1
                    Else
                        Exit Do
                    End If
                Loop
                order(b + 1) = tmp
            Next a
            Dim supply As Double, consumed As Double, stockout As Long, cpConsumed As Double
            Dim need As Double, cumulative As Double, shortQ As Double, lastF As Double, dueI As Long, startI As Long
            Dim useDaily As Boolean
            supply = gStock(m)
            For a = 1 To no
                L = order(a)
                consumed = 0
                stockout = -1
                For i = 0 To nd - 1
                    consumed = consumed + demand(i)
                    If supply - consumed < -EPS Then stockout = i: Exit For
                Next i
                useDaily = (hasLT And Not gLot(L).lt)
                cpConsumed = consumed
                If useDaily And stockout >= 0 Then
                    cpConsumed = 0
                    For i = 0 To stockout
                        cpConsumed = cpConsumed + dailyD(i)
                    Next i
                End If
                If stockout >= 0 Then
                    need = cpConsumed - supply
                    If need < 0 Then need = 0
                Else
                    need = 0
                End If
                gLot(L).cpFirst = cpN + 1
                gLot(L).cpN = 0
                If stockout >= 0 And gLot(L).qty > 0 Then
                    cumulative = cpConsumed
                    lastF = -1
                    For i = stockout To nd - 1
                        If gLot(L).cpN >= 40 Then Exit For
                        If i > stockout Then
                            If useDaily Then cumulative = cumulative + dailyD(i) Else cumulative = cumulative + demand(i)
                        End If
                        shortQ = cumulative - supply
                        If shortQ > gLot(L).qty Then shortQ = gLot(L).qty
                        Dim lastQ As Double
                        If gLot(L).cpN > 0 Then lastQ = cpFrac(cpN) * gLot(L).qty Else lastQ = 0
                        If shortQ > lastQ + EPS Then
                            Dim fr As Double
                            fr = shortQ / gLot(L).qty
                            If fr > 1 Then fr = 1
                            AddCp days(i), fr
                            gLot(L).cpN = gLot(L).cpN + 1
                        End If
                        If shortQ >= gLot(L).qty - EPS Then Exit For
                    Next i
                End If
                supply = supply + gLot(L).qty
                If stockout >= 0 Then
                    dueI = stockout
                Else
                    dueI = -1
                    For i = 0 To nd - 1
                        If days(i) = gLot(L).due Then dueI = i: Exit For
                    Next i
                    If dueI < 0 Then
                        For i = 0 To nd - 1
                            If days(i) >= gLot(L).due Then dueI = i: Exit For
                        Next i
                        If dueI < 0 Then dueI = nd - 1
                    End If
                End If
                ' back by safety days (working days; today always counts)
                startI = dueI
                Dim leftN As Long
                leftN = gSafety
                Do While leftN > 0 And startI > 0
                    startI = startI - 1
                    If cnt(startI) Then leftN = leftN - 1
                Loop
                If gLot(L).qty > 0 Then
                    gLot(L).needF = need / gLot(L).qty
                    If gLot(L).needF > 1 Then gLot(L).needF = 1
                Else
                    gLot(L).needF = 0
                End If
                gLot(L).noSO = (stockout < 0)
                gLot(L).due = days(dueI)
                gLot(L).earliest = days(startI)
                If hasLT And Not gLot(L).lt And stockout >= 0 And gLot(L).cpN = 0 Then gLot(L).lt = True
                If gLot(L).lt Then
                    gLot(L).phase = PH_FILL
                    gLot(L).urgency = 0
                ElseIf gLot(L).phase <> PH_BACKLOG Then
                    If startI = 0 Then
                        gLot(L).phase = PH_URGENT
                        gLot(L).urgency = 99 - dueI
                        If gLot(L).urgency < 1 Then gLot(L).urgency = 1
                    Else
                        gLot(L).phase = PH_FILL
                        gLot(L).urgency = 0
                    End If
                End If
            Next a
        End If
    Next m
End Sub

' Delivery moment of a need day: the cut-off time (08:00) on that day; backlog
' and today's need: the next day. As production day + net minute.
Private Sub DeadlineOf(ByVal due As Long, ByRef dlDate As Long, ByRef dlNet As Double)
    Dim calDay As Long, clock As Double
    If due <= gPlanDate Then calDay = gPlanDate + 1 Else calDay = due
    If gCutoff < gShiftStart Then
        dlDate = calDay - 1
        clock = gCutoff + 1440
    Else
        dlDate = calDay
        clock = gCutoff
    End If
    dlNet = ClockToNet(clock, 3)
End Sub

' ---- sorting ------------------------------------------------------------------------
' mode 1: demand order (buildDemandSchedule). mode 2: scheduling order (schedule()).
Private Function LotBefore(ByRef a As TLot, ByRef b As TLot, ByVal mode As Long) As Long
    Dim x As Double, y As Double
    LotBefore = 0
    If a.lt <> b.lt Then
        If a.lt Then LotBefore = 1 Else LotBefore = -1
        Exit Function
    End If
    If a.phase <> b.phase Then
        If a.phase < b.phase Then LotBefore = -1 Else LotBefore = 1
        Exit Function
    End If
    If mode = 2 Then
        If a.boost <> b.boost Then
            If a.boost Then LotBefore = -1 Else LotBefore = 1
            Exit Function
        End If
    End If
    If a.due <> b.due Then
        If a.due < b.due Then LotBefore = -1 Else LotBefore = 1
        Exit Function
    End If
    If a.urgency <> b.urgency Then
        If a.urgency > b.urgency Then LotBefore = -1 Else LotBefore = 1
        Exit Function
    End If
    If mode = 2 Then
        x = CountFor(a.mat)
        y = CountFor(b.mat)
        If x <> y Then
            If x < y Then LotBefore = -1 Else LotBefore = 1
        End If
    End If
End Function

' Stable merge sort of gLot(1..gLotN).
Private Sub SortLots(ByVal mode As Long)
    Dim tmp() As TLot
    If gLotN < 2 Then Exit Sub
    ReDim tmp(1 To gLotN)
    MergeSort 1, gLotN, tmp, mode
End Sub

Private Sub MergeSort(ByVal lo As Long, ByVal hi As Long, ByRef tmp() As TLot, ByVal mode As Long)
    Dim md As Long, i As Long, j As Long, k As Long
    If hi <= lo Then Exit Sub
    md = (lo + hi) \ 2
    MergeSort lo, md, tmp, mode
    MergeSort md + 1, hi, tmp, mode
    i = lo: j = md + 1: k = lo
    Do While i <= md And j <= hi
        If LotBefore(gLot(j), gLot(i), mode) < 0 Then
            CopyLot tmp(k), gLot(j): j = j + 1
        Else
            CopyLot tmp(k), gLot(i): i = i + 1
        End If
        k = k + 1
    Loop
    Do While i <= md
        CopyLot tmp(k), gLot(i): i = i + 1: k = k + 1
    Loop
    Do While j <= hi
        CopyLot tmp(k), gLot(j): j = j + 1: k = k + 1
    Loop
    For k = lo To hi
        CopyLot gLot(k), tmp(k)
    Next k
End Sub

' Field-by-field copy of a lot (whole-record assignment between array
' elements is not reliable in every VBA host).
Private Sub CopyLot(ByRef d As TLot, ByRef s As TLot)
    d.mat = s.mat
    d.qty = s.qty
    d.due = s.due
    d.earliest = s.earliest
    d.bucket = s.bucket
    d.phase = s.phase
    d.urgency = s.urgency
    d.lt = s.lt
    d.needF = s.needF
    d.noSO = s.noSO
    d.cpFirst = s.cpFirst
    d.cpN = s.cpN
    d.boost = s.boost
    d.dlDate = s.dlDate
    d.dlNet = s.dlNet
    d.seq = s.seq
    d.rule = s.rule
End Sub

Private Sub SaveBaseLots()
    Dim L As Long
    gBaseLotN = gLotN
    gBaseCpN = cpN
    ReDim gBaseLot(1 To gLotN + 1)
    For L = 1 To gLotN
        CopyLot gBaseLot(L), gLot(L)
    Next L
End Sub

Private Sub RestoreBaseLots()
    Dim L As Long
    gLotN = gBaseLotN
    cpN = gBaseCpN
    ReDim gLot(1 To gLotN + 1)
    For L = 1 To gLotN
        CopyLot gLot(L), gBaseLot(L)
    Next L
End Sub

' =====================================================================================
' Late-job repair: plan, boost late lots to the head of their phase, re-plan
' (planPipeline: up to 6 rounds, best plan by score)
' =====================================================================================
Private Sub RepairAndSchedule()
    Dim boostKeys As New Collection, rnd_ As Long, j As Long, key As String
    Dim bestScore As Variant, sc As Variant, bestRound As Long, nBoost As Long, added As Boolean
    Dim boostList() As String, nb As Long
    ReDim boostList(1 To 1)
    ScheduleOnce boostList, 0
    bestScore = ScoreOf()
    bestRound = 0
    Dim roundBoost() As Variant
    ReDim roundBoost(0 To gRounds)
    roundBoost(0) = Empty
    For rnd_ = 1 To gRounds
        If CountLate() = 0 Then Exit For
        added = False
        For j = 1 To gJobN
            If gJob(j).late Then
                key = gJob(j).mat & "|" & gLot(gJob(j).lot).bucket
                If ColIndex(boostKeys, key) = 0 Then
                    nb = nb + 1
                    ReDim Preserve boostList(1 To nb)
                    boostList(nb) = key
                    boostKeys.Add nb, "k" & key
                    added = True
                End If
            End If
        Next j
        If Not added Then Exit For
        Status "late-job repair, round " & rnd_ & " of " & gRounds & " (" & CountLate() & " late jobs)"
        ScheduleOnce boostList, nb
        sc = ScoreOf()
        If Better(sc, bestScore) Then
            bestScore = sc
            bestRound = rnd_
        End If
        Dim keepList() As String, q As Long
        ReDim keepList(1 To nb)
        For q = 1 To nb
            keepList(q) = boostList(q)
        Next q
        roundBoost(rnd_) = keepList
    Next rnd_
    ' rebuild the best plan (deterministic)
    If bestRound = 0 Then
        ScheduleOnce boostList, 0
    Else
        Dim bl() As String
        bl = roundBoost(bestRound)
        ScheduleOnce bl, UBound(bl)
    End If
    Warn "Late-job repair: " & bestRound & " boost round(s) used for the chosen plan."
End Sub

Private Function ScoreOf() As Variant
    Dim j As Long, uDaily As Long, uLT As Long, lateJobs As Long, lateMin As Double
    Dim mats As New Collection
    For j = 1 To gUnN
        If gUn(j).lt Then uLT = uLT + 1 Else uDaily = uDaily + 1
    Next j
    For j = 1 To gJobN
        If gJob(j).late Then
            lateJobs = lateJobs + 1
            lateMin = lateMin + gJob(j).lateMin
            If ColIndex(mats, gJob(j).mat) = 0 Then mats.Add 1, "k" & gJob(j).mat
        End If
    Next j
    ScoreOf = Array(uDaily, mats.Count, Int(lateMin / 60 + 0.5), lateJobs, uLT)
End Function

Private Function Better(ByVal a As Variant, ByVal b As Variant) As Boolean
    Dim i As Long
    For i = 0 To 4
        If a(i) <> b(i) Then Better = (a(i) < b(i)): Exit Function
    Next i
    Better = False
End Function

Private Function CountLate() As Long
    Dim j As Long
    For j = 1 To gJobN
        If gJob(j).late Then CountLate = CountLate + 1
    Next j
End Function

' =====================================================================================
' Scheduler (scheduler.schedule)
' =====================================================================================
Private Sub ResetSchedule()
    Dim p As Long
    bN = 0
    ReDim bS(1 To 64): ReDim bE(1 To 64): ReDim bMat(1 To 64): ReDim bNoSetup(1 To 64)
    ReDim bSetupIf(1 To 64): ReDim bEarliest(1 To 64): ReDim bAdded(1 To 64): ReDim bLT(1 To 64): ReDim bJob(1 To 64)
    bkCap = 32
    ReDim bkIdx(1 To gWN + 1, 1 To bkCap)
    For p = 1 To gWN
        gW(p).bkN = 0
    Next p
    hlN = 0
    ReDim hlNext(1 To 64)
    ReDim hlHead(0 To gH * 7 + 2)
    ReDim hlHall(1 To 64): ReDim hlType(1 To 64): ReDim hlDate(1 To 64): ReDim hlS(1 To 64): ReDim hlE(1 To 64): ReDim hlPress(1 To 64)
    muN = 0
    ReDim muNext(1 To 64)
    ReDim muHead(0 To gPN + 1)
    ReDim muTail(0 To gPN + 1)
    ReDim cntCache(0 To gPN + 1)
    Dim q As Long
    For q = 0 To gPN + 1
        cntCache(q) = -1
    Next q
    ReDim muMat(1 To 64): ReDim muDate(1 To 64): ReDim muPress(1 To 64): ReDim muS(1 To 64): ReDim muE(1 To 64)
    gJobN = 0
    ReDim gJob(1 To 16)
    sgN = 0
    ReDim sgKind(1 To 64): ReDim sgDate(1 To 64): ReDim sgS(1 To 64): ReDim sgE(1 To 64)
    gUnN = 0
    ReDim gUn(1 To 16)
    gStep = 0
End Sub

Private Sub ScheduleOnce(ByRef boostList() As String, ByVal nb As Long)
    Dim L As Long, i As Long, key As String, keys As New Collection
    RestoreBaseLots
    For i = 1 To nb
        On Error Resume Next
        keys.Add 1, "k" & boostList(i)
        On Error GoTo 0
    Next i
    For L = 1 To gLotN
        key = gLot(L).mat & "|" & gLot(L).bucket
        gLot(L).boost = (ColIndex(keys, key) > 0)
    Next L
    ResetSchedule
    SortLots 2
    Dim p As Long, cands As Collection, allowed As Collection, runs As Variant, r As Long, produced As Double
    Dim nLots As Long
    nLots = gLotN ' mould-limit parts are appended as extra lots; they are not iterated again
    For L = 1 To nLots
        p = ProdOf(gLot(L).mat)
        If p = 0 Then
            AddUnplanned L, gLot(L).qty, "No master data record found"
        Else
            Set cands = Eligible(p)
            Set allowed = New Collection
            For i = 1 To cands.Count
                If ColIndex(gPressIdx, CStr(cands.Item(i))) > 0 Then allowed.Add ColIndex(gPressIdx, CStr(cands.Item(i)))
            Next i
            If allowed.Count = 0 Then
                If Not gP(p).flex And (gP(p).alt1 & gP(p).alt2 & gP(p).alt3 & gP(p).alt4) <> "" Then
                    AddUnplanned L, gLot(L).qty, "No main work center defined - alternatives are used only when Flexible = Y"
                Else
                    AddUnplanned L, gLot(L).qty, "No eligible work center (main and alternative machines are undefined or not in Work Centers)"
                End If
            Else
                runs = SplitRuns(p, gLot(L).qty)
                produced = 0
                For r = LBound(runs) To UBound(runs)
                    Dim entry As Long
                    If UBound(runs) > LBound(runs) Then
                        entry = RunShareOf(L, produced, runs(r))
                    Else
                        entry = L
                    End If
                    If Not PlaceRun(entry, L, p, RunPlanOf(p, runs(r)), allowed) Then
                        AddUnplanned L, runs(r), "Not enough free capacity in the visible calendar"
                    End If
                    produced = produced + runs(r)
                Next r
            End If
        End If
    Next L
    ApplyAddedSetups
End Sub

Private Sub AddUnplanned(ByVal L As Long, ByVal q As Double, ByVal reason As String)
    gUnN = gUnN + 1
    If gUnN > UBound(gUn) Then
        ReDim Preserve gUn(1 To gUnN * 2)
    End If
    With gUn(gUnN)
        .mat = gLot(L).mat
        .qty = q
        .phase = gLot(L).phase
        .due = gLot(L).due
        .reason = reason
        .lt = gLot(L).lt
        .bucket = gLot(L).bucket
    End With
End Sub

' runShareOf: a mould-limit part of a lot covers [before, before+q) of it.
Private Function RunShareOf(ByVal L As Long, ByVal before As Double, ByVal q As Double) As Long
    Dim total As Double, a As Double, b As Double, n As Long, k As Long, nn As Long
    total = gLot(L).qty
    If total <= 0 Or q >= total Then RunShareOf = L: Exit Function
    a = before / total
    b = (before + q) / total
    n = NewLot()
    CopyLot gLot(n), gLot(L)
    gLot(n).qty = q
    gLot(n).cpFirst = cpN + 1
    gLot(n).cpN = 0
    For k = gLot(L).cpFirst To gLot(L).cpFirst + gLot(L).cpN - 1
        If cpFrac(k) > a + 0.000000001 Then
            Dim f As Double
            f = cpFrac(k)
            If f > b Then f = b
            AddCp cpDate(k), (f - a) / (b - a)
            cpDl(cpN) = cpDl(k)
            cpDlNet(cpN) = cpDlNet(k)
            gLot(n).cpN = gLot(n).cpN + 1
        End If
    Next k
    Dim need As Double, noNeed As Boolean
    need = gLot(L).needF
    If gLot(L).cpN > 0 Then
        noNeed = (gLot(n).cpN = 0)
    Else
        noNeed = (need <= a + 0.000000001)
    End If
    If need > a Then
        f = need
        If f > b Then f = b
        gLot(n).needF = (f - a) / (b - a)
    Else
        gLot(n).needF = 0
    End If
    gLot(n).noSO = gLot(L).noSO Or noNeed
    RunShareOf = n
End Function

' ---- press timeline helpers ----------------------------------------------------------
Private Function BkAt(ByVal p As Long, ByVal k As Long) As Long
    BkAt = bkIdx(p, k)
End Function

' index (1-based) of the first booking whose end > value; bkN+1 if none
Private Function FirstEndAfter(ByVal p As Long, ByVal value As Double) As Long
    Dim lo As Long, hi As Long, md As Long
    lo = 1: hi = gW(p).bkN + 1
    Do While lo < hi
        md = (lo + hi) \ 2
        If bE(bkIdx(p, md)) <= value Then lo = md + 1 Else hi = md
    Loop
    FirstEndAfter = lo
End Function

Private Function FirstOverlap(ByVal p As Long, ByVal s As Double, ByVal e As Double) As Long
    Dim k As Long, b As Long
    For k = FirstEndAfter(p, s) To gW(p).bkN
        b = bkIdx(p, k)
        If bS(b) >= e Then FirstOverlap = 0: Exit Function
        If bE(b) > s Then FirstOverlap = b: Exit Function
    Next k
    FirstOverlap = 0
End Function

Private Function FirstFreePoint(ByVal p As Long, ByVal from As Double) As Double
    Dim k As Long, b As Long, pt As Double
    pt = from
    If pt < 0 Then pt = 0
    For k = FirstEndAfter(p, pt) To gW(p).bkN
        b = bkIdx(p, k)
        If bS(b) > pt Then Exit For
        pt = bE(b)
    Next k
    FirstFreePoint = pt
End Function

Private Function MaterialBefore(ByVal p As Long, ByVal at As Double) As String
    Dim k As Long
    k = FirstEndAfter(p, at) - 1
    If k >= 1 Then MaterialBefore = bMat(bkIdx(p, k)) Else MaterialBefore = ""
End Function

' global day index (into dy arrays) containing the minute (or the next day)
Private Function DayIndexAt(ByVal p As Long, ByVal minute As Double) As Long
    Dim lo As Long, hi As Long, md As Long, f As Long
    f = gW(p).dayFirst
    lo = 0: hi = gW(p).dayN
    Do While lo < hi
        md = (lo + hi) \ 2
        If minute >= dyOff(f + md) + dyCap(f + md) Then lo = md + 1 Else hi = md
    Loop
    If lo >= gW(p).dayN Then DayIndexAt = 0 Else DayIndexAt = f + lo
End Function

Private Function OffsetOfDate(ByVal p As Long, ByVal d As Long) As Double
    Dim k As Long
    For k = gW(p).dayFirst To gW(p).dayFirst + gW(p).dayN - 1
        If dyDate(k) >= d Then OffsetOfDate = dyOff(k): Exit Function
    Next k
    OffsetOfDate = gW(p).total
End Function

Private Sub Locate(ByVal p As Long, ByVal minute As Double, ByRef d As Long, ByRef m As Double)
    Dim i As Long, x As Double
    x = minute - 1
    If x < 0 Then x = 0
    i = DayIndexAt(p, x)
    If i = 0 Then
        If gW(p).dayN = 0 Then d = 0: m = 0: Exit Sub
        i = gW(p).dayFirst + gW(p).dayN - 1
    End If
    x = minute - dyOff(i)
    If x < 0 Then x = 0
    If x > dyCap(i) Then x = dyCap(i)
    d = dyDate(i)
    m = dyStartNet(i) + x
End Sub

Private Sub AddTSeg(ByVal kind As Long, ByVal d As Long, ByVal s As Double, ByVal e As Double)
    tN = tN + 1
    If tN > UBound(tKind) Then
        ReDim Preserve tKind(1 To tN * 2)
        ReDim Preserve tDate(1 To tN * 2)
        ReDim Preserve tS(1 To tN * 2)
        ReDim Preserve tE(1 To tN * 2)
    End If
    tKind(tN) = kind
    tDate(tN) = d
    tS(tN) = s
    tE(tN) = e
End Sub

' toDatedSegments: split [s, e) of the press axis into day pieces
Private Sub DatedSegments(ByVal p As Long, ByVal kind As Long, ByVal s As Double, ByVal e As Double)
    Dim i As Long, last As Long, from As Double, upto As Double
    i = DayIndexAt(p, s)
    If i = 0 Then Exit Sub
    last = gW(p).dayFirst + gW(p).dayN - 1
    Do While i <= last
        If dyOff(i) >= e Then Exit Do
        from = s
        If dyOff(i) > from Then from = dyOff(i)
        upto = e
        If dyOff(i) + dyCap(i) < upto Then upto = dyOff(i) + dyCap(i)
        If upto > from Then
            AddTSeg kind, dyDate(i), dyStartNet(i) + (from - dyOff(i)), dyStartNet(i) + (upto - dyOff(i))
            If upto >= e Then Exit Do
        End If
        i = i + 1
    Loop
End Sub

Private Function SetupNetLength(ByVal p As Long, ByVal glob As Double, ByVal minutes As Double) As Double
    Dim i As Long, n As Long, pos As Double, lft As Double, net As Double, k As Long, runLen As Double
    i = DayIndexAt(p, glob)
    If i = 0 Or minutes <= 0 Then SetupNetLength = minutes: Exit Function
    n = dyShifts(i)
    If brN(n) = 0 Then SetupNetLength = minutes: Exit Function
    pos = dyStartNet(i) + (glob - dyOff(i))
    lft = minutes
    For k = 1 To brN(n)
        If brAt(n, k) >= pos - 0.000000001 Then
            runLen = brAt(n, k) - pos
            If lft <= runLen + 0.000000001 Then SetupNetLength = net + lft: Exit Function
            net = net + runLen
            lft = lft - runLen
            pos = brAt(n, k)
            lft = lft - brMin(n, k)
            If lft <= 0.000000001 Then SetupNetLength = net: Exit Function
        End If
    Next k
    SetupNetLength = net + lft
End Function

' Shift end after a net minute of the day (setups that must not cross a shift change)
Private Function ShiftEndAfter(ByVal within As Double, ByVal dayCap As Double) As Double
    Dim i As Long, st As Double, en As Double
    For i = 1 To MAX_SHIFTS
        en = st + gShiftNet(i)
        If within < en Then
            If en < dayCap Then ShiftEndAfter = en Else ShiftEndAfter = dayCap
            Exit Function
        End If
        st = en
    Next i
    ShiftEndAfter = dayCap
End Function

' index of a production day in the setup log
Private Function HallDay(ByVal d As Long) As Long
    HallDay = d - gBase + 1
    If HallDay < 0 Then HallDay = 0
    If HallDay > gH * 7 + 2 Then HallDay = gH * 7 + 2
End Function

' plant coordinate of a day-internal net minute (to compare setups across presses and days)
Private Function PlantAt(ByVal d As Long, ByVal within As Double) As Double
    PlantAt = CDbl(d - gBase) * gFullNet + within
End Function

' earliestFreeStart (scheduler.ts): same type needs the gap and at most `concurrent`
' overlaps; the other type may not overlap; mould setups also count plant-wide.
' Intervals are kept per production day (day-internal net minutes); the
' neighbouring days are shifted by one full day of net minutes, as on the website.
Private Function EarliestFreeStart(ByVal hall As String, ByVal typ As Long, ByVal gap As Double, ByVal d As Long, _
                                   ByVal earliest As Double, ByVal dayEnd As Double, ByVal duration As Double, _
                                   ByVal concurrent As Long, ByVal plantCap As Double, ByRef pendT() As Long, _
                                   ByRef pendD() As Long, ByRef pendS() As Double, ByRef pendE() As Double, ByVal pendN As Long) As Double
    Dim cand As Double, guard As Long, k As Long, nSame As Long, nOther As Long, nPlant As Long
    Dim nextC As Double, minSame As Double, maxOther As Double, minPlant As Double
    Dim ivS As Double, ivE As Double, sh As Double, ok As Boolean
    Dim smS() As Double, smE() As Double, smN As Long, otS() As Double, otE() As Double, otN As Long
    Dim plS() As Double, plE() As Double, plN As Long, usePlant As Boolean
    cand = earliest
    If duration <= 0 Then EarliestFreeStart = cand: Exit Function
    usePlant = (typ = 1 And plantCap < 1E+300)
    ReDim smS(1 To hlN + pendN + 1): ReDim smE(1 To hlN + pendN + 1)
    ReDim otS(1 To hlN + pendN + 1): ReDim otE(1 To hlN + pendN + 1)
    ReDim plS(1 To hlN + pendN + 1): ReDim plE(1 To hlN + pendN + 1)
    Dim dd As Long
    For dd = d - 1 To d + 1
    k = hlHead(HallDay(dd))
    Do While k > 0
        ok = False
        If hlDate(k) = d Then
            ivS = hlS(k): ivE = hlE(k): ok = True
        ElseIf hlDate(k) = d - 1 Then
            sh = -gFullNet
            If hlE(k) + sh > -360 Then
                ivS = hlS(k) + sh: ivE = hlE(k) + sh: ok = True
            End If
        ElseIf hlDate(k) = d + 1 Then
            sh = gFullNet
            If hlS(k) + sh < dayEnd + 360 Then
                ivS = hlS(k) + sh: ivE = hlE(k) + sh: ok = True
            End If
        End If
        If ok Then
            If hlHall(k) = hall Then
                If hlType(k) = typ Then
                    smN = smN + 1: smS(smN) = ivS: smE(smN) = ivE
                Else
                    otN = otN + 1: otS(otN) = ivS: otE(otN) = ivE
                End If
            End If
            If usePlant And hlType(k) = 1 Then plN = plN + 1: plS(plN) = ivS: plE(plN) = ivE
        End If
        k = hlNext(k)
    Loop
    Next dd
    For k = 1 To pendN
        ok = False
        If pendD(k) = d Then
            ivS = pendS(k): ivE = pendE(k): ok = True
        ElseIf pendD(k) = d - 1 Then
            ivS = pendS(k) - gFullNet: ivE = pendE(k) - gFullNet: ok = True
        ElseIf pendD(k) = d + 1 Then
            ivS = pendS(k) + gFullNet: ivE = pendE(k) + gFullNet: ok = True
        End If
        If ok Then
            If pendT(k) = typ Then
                smN = smN + 1: smS(smN) = ivS: smE(smN) = ivE
            Else
                otN = otN + 1: otS(otN) = ivS: otE(otN) = ivE
            End If
            If usePlant And pendT(k) = 1 Then plN = plN + 1: plS(plN) = ivS: plE(plN) = ivE
        End If
    Next k
    For guard = 1 To (smN + otN + plN + 1) * 2
        nSame = 0: nOther = 0: nPlant = 0
        minSame = 1E+300: maxOther = -1E+300: minPlant = 1E+300
        For k = 1 To smN
            If cand < smE(k) + gap And smS(k) < cand + duration + gap Then
                nSame = nSame + 1
                If smE(k) + gap < minSame Then minSame = smE(k) + gap
            End If
        Next k
        For k = 1 To otN
            If cand < otE(k) And otS(k) < cand + duration Then
                nOther = nOther + 1
                If otE(k) > maxOther Then maxOther = otE(k)
            End If
        Next k
        For k = 1 To plN
            If cand < plE(k) And plS(k) < cand + duration Then
                nPlant = nPlant + 1
                If plE(k) < minPlant Then minPlant = plE(k)
            End If
        Next k
        If nSame < concurrent And nOther = 0 And nPlant < plantCap Then
            EarliestFreeStart = cand
            Exit Function
        End If
        nextC = cand
        If nSame >= concurrent Then
            If minSame > nextC Then nextC = minSame
        End If
        If nOther > 0 Then
            If maxOther > nextC Then nextC = maxOther
        End If
        If nPlant >= plantCap Then
            If minPlant > nextC Then nextC = minPlant
        End If
        If nextC > cand Then cand = nextC Else cand = cand + 1
    Next guard
    EarliestFreeStart = cand
End Function

' reserveSlot: earliest place for a setup (typ 1) or coil change (typ 2) on the
' press axis; it may not cross the end of the day (or the shift when configured).
' Returns array(global, date, withinStart) or Empty.
Private Function ReserveSlot(ByVal p As Long, ByVal from As Double, ByVal duration As Double, ByVal typ As Long, _
                             ByVal gap As Double, ByVal concurrent As Long, ByVal plantCap As Double, _
                             ByRef pendT() As Long, ByRef pendD() As Long, ByRef pendS() As Double, ByRef pendE() As Double, ByVal pendN As Long) As Variant
    Dim i As Long, cursor As Double, guard As Long, within As Double, dayEnd As Double, shEnd As Double
    Dim cand As Double
    ReserveSlot = Empty
    If duration <= 0 Then
        i = DayIndexAt(p, from)
        If i = 0 Then Exit Function
        within = dyStartNet(i) + (from - dyOff(i))
        If within < dyStartNet(i) Then within = dyStartNet(i)
        ReserveSlot = Array(from, dyDate(i), within)
        Exit Function
    End If
    cursor = from
    For guard = 1 To gW(p).dayN * 4 + 8
        i = DayIndexAt(p, cursor)
        If i = 0 Then Exit Function
        If cursor < dyOff(i) Then cursor = dyOff(i)
        within = dyStartNet(i) + (cursor - dyOff(i))
        dayEnd = dyStartNet(i) + dyCap(i)
        If gCross Then shEnd = dayEnd Else shEnd = ShiftEndAfter(within, dayEnd)
        cand = EarliestFreeStart(gW(p).hall, typ, gap, dyDate(i), within, dayEnd, duration, concurrent, plantCap, pendT, pendD, pendS, pendE, pendN)
        If cand + duration <= shEnd + 0.000000001 Then
            ReserveSlot = Array(dyOff(i) + (cand - dyStartNet(i)), dyDate(i), cand)
            Exit Function
        End If
        cursor = dyOff(i) + (shEnd - dyStartNet(i))
        If cursor >= dyOff(i) + dyCap(i) Then
            Dim nx As Long
            nx = DayIndexAt(p, dyOff(i) + dyCap(i))
            If nx = 0 Then Exit Function
            If dyOff(nx) > cursor Then cursor = dyOff(nx)
        End If
    Next guard
End Function

' Mould spans of the attempt (dieSpans): per date, start..end (whole days between).
Private Function MoldConflict(ByVal mat As String, ByVal p As Long, ByRef cDate As Long, ByRef cEnd As Double, ByRef cPress As Long) As Boolean
    Dim firstD As Long, lastD As Long, k As Long, d As Long, s As Double, e As Double, u As Long
    If tN = 0 Then Exit Function
    firstD = tDate(1): lastD = tDate(1)
    For k = 1 To tN
        If tDate(k) < firstD Then firstD = tDate(k)
        If tDate(k) > lastD Then lastD = tDate(k)
    Next k
    ' Same order as the website's Map: dates that have pieces first, then the
    ' days in between (non-working days the die stays mounted over).
    Dim pass As Long
    For pass = 1 To 2
    For d = firstD To lastD
        s = 1E+300: e = -1E+300
        Dim hasSeg As Boolean
        hasSeg = False
        For k = 1 To tN
            If tDate(k) = d Then
                hasSeg = True
                If tS(k) < s Then s = tS(k)
                If tE(k) > e Then e = tE(k)
            End If
        Next k
        If firstD <> lastD Then
            If Not (d = firstD And hasSeg) Then s = DAY_OPEN
            If Not (d = lastD And hasSeg) Then e = DAY_CLOSE
        End If
        If (pass = 1 And hasSeg) Or (pass = 2 And Not hasSeg And firstD <> lastD) Then
            u = muHead(ProdOf(mat))
            Do While u > 0
                If muDate(u) = d And muPress(u) <> p Then
                    If muS(u) < e And s < muE(u) Then
                        cDate = d
                        cEnd = muE(u)
                        If cEnd > DAY_CLOSE - 1 Then cEnd = DAY_CLOSE - 1
                        cPress = muPress(u)
                        MoldConflict = True
                        Exit Function
                    End If
                End If
                u = muNext(u)
            Loop
        End If
    Next d
    Next pass
End Function

Private Function DieMovedSince(ByVal p As Long, ByVal mat As String, ByVal at As Double) As Boolean
    Dim k As Long, fD As Long, fM As Double, tD As Long, tM As Double, u As Long
    k = FirstEndAfter(p, at) - 1
    If k < 1 Then Exit Function
    Locate p, bE(bkIdx(p, k)), fD, fM
    Locate p, at, tD, tM
    u = muHead(ProdOf(mat))
    Do While u > 0
        If muPress(u) <> p Then
            If muDate(u) >= fD And muDate(u) <= tD Then
                If Not (muDate(u) = fD And muE(u) <= fM) And Not (muDate(u) = tD And muS(u) >= tM) Then
                    DieMovedSince = True
                    Exit Function
                End If
            End If
        End If
        u = muNext(u)
    Loop
End Function

' ---- delivery check -----------------------------------------------------------------
' readyAt over the run segments of an attempt (segment arrays passed in).
Private Sub ReadyAt(ByRef kinds() As Long, ByRef dts() As Long, ByRef ss() As Double, ByRef es() As Double, _
                    ByVal f As Long, ByVal n As Long, ByVal fraction As Double, ByRef rD As Long, ByRef rM As Double)
    Dim total As Double, k As Long, target As Double, done As Double, ln As Double, lastRun As Long
    For k = f To f + n - 1
        If kinds(k) = K_RUN Then total = total + (es(k) - ss(k)): lastRun = k
    Next k
    If lastRun = 0 Then
        If n > 0 Then rD = dts(f + n - 1): rM = es(f + n - 1) Else rD = 0: rM = 0
        Exit Sub
    End If
    If fraction < 0 Then fraction = 0
    If fraction > 1 Then fraction = 1
    target = fraction * total
    For k = f To f + n - 1
        If kinds(k) = K_RUN Then
            ln = es(k) - ss(k)
            If done + ln >= target - 0.000000001 Then
                rD = dts(k)
                rM = ss(k) + IIf(target - done > 0, target - done, 0)
                Exit Sub
            End If
            done = done + ln
        End If
    Next k
    rD = dts(lastRun): rM = es(lastRun)
End Sub

Private Function AfterMoment(ByVal rD As Long, ByVal rM As Double, ByVal d As Long, ByVal net As Double) As Boolean
    AfterMoment = (rD > d) Or (rD = d And rM > net + EPS)
End Function

' deliveryCheck: late?, ready moment, deadline used
Private Function Delivery(ByVal L As Long, ByRef kinds() As Long, ByRef dts() As Long, ByRef ss() As Double, ByRef es() As Double, _
                          ByVal f As Long, ByVal n As Long, ByRef rD As Long, ByRef rM As Double, _
                          ByRef dD As Long, ByRef dN As Double) As Boolean
    Dim k As Long, j As Long, strict As Boolean
    Delivery = False
    dD = gLot(L).dlDate: dN = gLot(L).dlNet
    If gLot(L).noSO Or gLot(L).lt Then
        ReadyAt kinds, dts, ss, es, f, n, 0, rD, rM
        dD = 0: dN = 0
        Exit Function
    End If
    If gLot(L).cpN > 0 Then
        ' strictest point per deadline, in order of first appearance
        For k = gLot(L).cpFirst To gLot(L).cpFirst + gLot(L).cpN - 1
            strict = True
            For j = gLot(L).cpFirst To gLot(L).cpFirst + gLot(L).cpN - 1
                If j <> k And cpDl(j) = cpDl(k) And cpDlNet(j) = cpDlNet(k) Then
                    If cpFrac(j) > cpFrac(k) Or (cpFrac(j) = cpFrac(k) And j < k) Then strict = False
                End If
            Next j
            If strict Then
                ReadyAt kinds, dts, ss, es, f, n, cpFrac(k), rD, rM
                If AfterMoment(rD, rM, cpDl(k), cpDlNet(k)) Then
                    dD = cpDl(k): dN = cpDlNet(k)
                    Delivery = True
                    Exit Function
                End If
            End If
        Next k
        k = gLot(L).cpFirst
        ReadyAt kinds, dts, ss, es, f, n, cpFrac(k), rD, rM
        dD = cpDl(k): dN = cpDlNet(k)
        Exit Function
    End If
    ReadyAt kinds, dts, ss, es, f, n, gLot(L).needF, rD, rM
    Delivery = AfterMoment(rD, rM, gLot(L).dlDate, gLot(L).dlNet)
End Function

Private Function AttemptLate(ByVal L As Long) As Boolean
    Dim rD As Long, rM As Double, dD As Long, dN As Double
    AttemptLate = Delivery(L, tKind, tDate, tS, tE, 1, tN, rD, rM, dD, dN)
End Function

' ---- one attempt on one press (tryPlaceOnPress) ----------------------------------------
' Placement: Array(0 press, 1 date, 2 endDate, 3 setupStart, 4 startGlobal, 5 endGlobal,
'   6 sameMaterial, 7 endMinute, 8 segs(kind,date,s,e as 4 arrays), 9 segN, 10 moldRes(date,s,e)|Empty,
'   11 coilRes (3 arrays), 12 coilN, 13 follow(global,date,start,minutes)|Empty, 14 urgent, 15 late)
Private Function TryPlace(ByVal L As Long, ByVal pr As Long, ByVal rp As Variant, ByVal earliestG As Double, _
                          ByVal urgent As Boolean) As Variant
    Dim chMin As Double, plantCap As Double, concurrent As Long, start As Double, guard As Long
    Dim same As Boolean, setupMin As Double, slot As Variant, cursor As Double, setupStartG As Double
    Dim setupNet As Double, moldRes As Variant, k As Long, runs As Variant, ci As Long, endG As Double
    Dim pendT() As Long, pendD() As Long, pendS() As Double, pendE() As Double, pendN As Long, busy As Long
    Dim cDate As Long, cEnd As Double, cPress As Long, follow As Variant
    Dim coilD() As Long, coilS() As Double, coilE() As Double, coilN As Long
    TryPlace = Empty
    If gW(pr).feeds Then chMin = rp(4) Else chMin = 0
    If urgent Then plantCap = gCapUrgent Else plantCap = gCapNormal
    If urgent Then
        concurrent = gHallConc
        If gCapUrgent > concurrent Then concurrent = gCapUrgent
    Else
        concurrent = gHallConc
    End If
    runs = rp(9)
    start = FirstFreePoint(pr, earliestG)
    For guard = 1 To gW(pr).dayN * 2 + 24
        same = (MaterialBefore(pr, start) = gLot(L).mat)
        If same Then same = Not DieMovedSince(pr, gLot(L).mat, start)
        If same Then setupMin = 0 Else setupMin = rp(5)
        tN = 0
        ReDim tKind(1 To 16): ReDim tDate(1 To 16): ReDim tS(1 To 16): ReDim tE(1 To 16)
        pendN = 0
        ReDim pendT(1 To 4): ReDim pendD(1 To 4): ReDim pendS(1 To 4): ReDim pendE(1 To 4)
        coilN = 0
        ReDim coilD(1 To 4): ReDim coilS(1 To 4): ReDim coilE(1 To 4)
        moldRes = Empty
        follow = Empty
        slot = ReserveSlot(pr, start, setupMin, 1, gSetupGap, concurrent, plantCap, pendT, pendD, pendS, pendE, 0)
        If IsEmpty(slot) Then Exit Function
        cursor = slot(0)
        setupStartG = cursor
        If setupMin > 0 Then
            setupNet = SetupNetLength(pr, cursor, setupMin)
            DatedSegments pr, K_SETUP, cursor, cursor + setupNet
            moldRes = Array(slot(1), slot(2), slot(2) + setupNet)
            pendN = 1
            pendT(1) = 1
            pendD(1) = slot(1)
            pendS(1) = slot(2)
            pendE(1) = slot(2) + setupNet
            cursor = cursor + setupNet
        End If
        If rp(6) > 0 Then
            DatedSegments pr, K_QUALITY, cursor, cursor + rp(6)
            cursor = cursor + rp(6)
        End If
        Dim failed As Boolean
        failed = False
        For ci = LBound(runs) To UBound(runs)
            If ci > LBound(runs) And chMin > 0 Then
                Dim cs As Variant
                cs = ReserveSlot(pr, cursor, chMin, 2, gCoilGap, 1, 1E+300, pendT, pendD, pendS, pendE, pendN)
                If IsEmpty(cs) Then failed = True: Exit For
                DatedSegments pr, K_COIL, cs(0), cs(0) + chMin
                coilN = coilN + 1
                If coilN > UBound(coilD) Then
                    ReDim Preserve coilD(1 To coilN * 2): ReDim Preserve coilS(1 To coilN * 2): ReDim Preserve coilE(1 To coilN * 2)
                End If
                coilD(coilN) = cs(1): coilS(coilN) = cs(2): coilE(coilN) = cs(2) + chMin
                pendN = pendN + 1
                If pendN > UBound(pendT) Then
                    ReDim Preserve pendT(1 To pendN * 2): ReDim Preserve pendD(1 To pendN * 2): ReDim Preserve pendS(1 To pendN * 2): ReDim Preserve pendE(1 To pendN * 2)
                End If
                pendT(pendN) = 2
                pendD(pendN) = cs(1)
                pendS(pendN) = cs(2)
                pendE(pendN) = cs(2) + chMin
                cursor = cs(0) + chMin
            End If
            If runs(ci) > 0 Then
                DatedSegments pr, K_RUN, cursor, cursor + runs(ci)
                cursor = cursor + runs(ci)
            End If
        Next ci
        If failed Then Exit Function
        endG = cursor
        If endG > gW(pr).total + 0.000000001 Then Exit Function
        ' busy press -> after that booking
        busy = FirstOverlap(pr, setupStartG, endG)
        If busy > 0 Then
            start = FirstFreePoint(pr, IIf(start + 1 > bE(busy), start + 1, bE(busy)))
            If start >= gW(pr).total Then Exit Function
            GoTo NextGuard
        End If
        ' a job entering a gap brings back the setup of the next (no-setup) job
        Dim nxK As Long, nx As Long
        nxK = FirstEndAfter(pr, endG)
        nx = 0
        If nxK <= gW(pr).bkN Then nx = bkIdx(pr, nxK)
        If nx > 0 Then
            If gLot(L).lt And bNoSetup(nx) And Not bLT(nx) And bMat(nx) <> gLot(L).mat And bS(nx) >= endG Then
                start = FirstFreePoint(pr, IIf(start + 1 > bE(nx), start + 1, bE(nx)))
                If start >= gW(pr).total Then Exit Function
                GoTo NextGuard
            End If
            If bNoSetup(nx) And bMat(nx) <> gLot(L).mat And bS(nx) >= endG Then
                Dim mins As Double, floorG As Double, s1 As Variant, s2 As Variant, netM As Double
                mins = bSetupIf(nx)
                floorG = endG
                If bEarliest(nx) > floorG Then floorG = bEarliest(nx)
                If mins > 0 Then
                    s1 = ReserveSlot(pr, IIf(floorG > bS(nx) - mins, floorG, bS(nx) - mins), mins, 1, gSetupGap, concurrent, plantCap, pendT, pendD, pendS, pendE, pendN)
                    If Not IsEmpty(s1) Then
                        If s1(0) + mins <= bS(nx) Then
                            s2 = s1
                        Else
                            s2 = ReserveSlot(pr, floorG, mins, 1, gSetupGap, concurrent, plantCap, pendT, pendD, pendS, pendE, pendN)
                        End If
                    Else
                        s2 = ReserveSlot(pr, floorG, mins, 1, gSetupGap, concurrent, plantCap, pendT, pendD, pendS, pendE, pendN)
                    End If
                    If Not IsEmpty(s2) Then netM = SetupNetLength(pr, s2(0), mins) Else netM = mins
                    If IsEmpty(s2) Then
                        start = FirstFreePoint(pr, IIf(start + 1 > bE(nx), start + 1, bE(nx)))
                        If start >= gW(pr).total Then Exit Function
                        GoTo NextGuard
                    ElseIf s2(0) + netM > bS(nx) Then
                        start = FirstFreePoint(pr, IIf(start + 1 > bE(nx), start + 1, bE(nx)))
                        If start >= gW(pr).total Then Exit Function
                        GoTo NextGuard
                    End If
                    follow = Array(s2(0), s2(1), s2(2), netM)
                End If
            End If
        End If
        ' mould in use on another press
        If MoldConflict(gLot(L).mat, pr, cDate, cEnd, cPress) Then
            Dim aft As Double, di As Long, found As Boolean
            found = False
            If cEnd < DAY_CLOSE - 1 Then
                For di = gW(pr).dayFirst To gW(pr).dayFirst + gW(pr).dayN - 1
                    If dyDate(di) = cDate Then
                        aft = dyOff(di) + IIf(cEnd - dyStartNet(di) > 0, cEnd - dyStartNet(di), 0)
                        found = True
                        Exit For
                    End If
                Next di
            End If
            If Not found Then
                aft = gW(pr).total
                For di = gW(pr).dayFirst To gW(pr).dayFirst + gW(pr).dayN - 1
                    If dyDate(di) > cDate Then aft = dyOff(di): Exit For
                Next di
            End If
            start = FirstFreePoint(pr, IIf(start + 1 > aft, start + 1, aft))
            If start >= gW(pr).total Then Exit Function
            GoTo NextGuard
        End If
        ' success
        Dim segs As Variant
        segs = Array(CopyL(tKind, tN), CopyL(tDate, tN), CopyD(tS, tN), CopyD(tE, tN))
        Dim coilsArr As Variant
        coilsArr = Array(CopyL(coilD, coilN), CopyD(coilS, coilN), CopyD(coilE, coilN))
        TryPlace = Array(pr, tDate(1), tDate(tN), tS(1), setupStartG, endG, same, tE(tN), segs, tN, moldRes, coilsArr, coilN, follow, urgent, AttemptLate(L))
        Exit Function
NextGuard:
    Next guard
End Function

Private Function CopyL(ByRef a() As Long, ByVal n As Long) As Variant
    Dim r() As Long, i As Long
    ReDim r(1 To IIf(n < 1, 1, n))
    For i = 1 To n
        r(i) = a(i)
    Next i
    CopyL = r
End Function

Private Function CopyD(ByRef a() As Double, ByVal n As Long) As Variant
    Dim r() As Double, i As Long
    ReDim r(1 To IIf(n < 1, 1, n))
    For i = 1 To n
        r(i) = a(i)
    Next i
    CopyD = r
End Function

Private Function EndsBefore(ByVal a As Variant, ByVal b As Variant) As Boolean
    EndsBefore = (a(2) < b(2)) Or (a(2) = b(2) And a(7) < b(7))
End Function

' Is a placement late (stored at index 15)
Private Function PlLate(ByVal pl As Variant) As Boolean
    PlLate = pl(15)
End Function

' placeRun: try every eligible press, choose; then book. Returns False if none fits.
Private Function PlaceRun(ByVal L As Long, ByVal lotIdx As Long, ByVal p As Long, ByVal rp As Variant, ByVal allowed As Collection) As Boolean
    Dim best As Variant, bestEarliest As Double, bestCont As Boolean, bestLate As Boolean
    Dim allowedDate As Long, alwaysUrgent As Boolean, noUrgency As Boolean, ci As Long, pr As Long
    Dim earliest As Double, pl As Variant, ut As Variant, cont As Boolean, k As Long, b As Long, c As Variant
    Dim late As Boolean
    best = Empty
    If gLot(L).phase = PH_FILL And gPull > 0 Then allowedDate = gLot(L).earliest - gPull Else allowedDate = gLot(L).earliest
    alwaysUrgent = (gLot(L).phase = PH_BACKLOG) Or gLot(L).boost
    noUrgency = (gLot(L).phase = PH_FILL) And Not gLot(L).boost
    For ci = 1 To allowed.Count
        pr = allowed.Item(ci)
        If gW(pr).dayN = 0 Then GoTo NextPress
        earliest = OffsetOfDate(pr, allowedDate)
        If FirstFreePoint(pr, earliest) >= gW(pr).total Then GoTo NextPress
        pl = TryPlace(L, pr, rp, earliest, alwaysUrgent)
        If Not alwaysUrgent And Not IsEmpty(pl) Then
            If PlLate(pl) Then
                ut = TryPlace(L, pr, rp, earliest, True)
                If Not IsEmpty(ut) Then
                    If EndsBefore(ut, pl) Then pl = ut
                End If
            End If
        End If
        cont = False
        If noUrgency Then
            ' setup-free continuation right after the same mould on this press
            Dim nb As Long, ends() As Double, nEnds As Long
            nb = gW(pr).bkN
            nEnds = 0
            ReDim ends(1 To nb + 1)
            For k = 1 To nb
                b = bkIdx(pr, k)
                If bMat(b) = gLot(L).mat And bE(b) >= earliest Then
                    If FirstFreePoint(pr, bE(b)) = bE(b) Then
                        nEnds = nEnds + 1
                        ends(nEnds) = bE(b)
                    End If
                End If
            Next k
            For k = 1 To nEnds
                c = TryPlace(L, pr, rp, ends(k), False)
                If Not IsEmpty(c) Then
                    If c(4) = ends(k) And c(6) And Not PlLate(c) Then
                        If Not cont Or IsEmpty(pl) Then
                            pl = c
                            cont = True
                        ElseIf EndsBefore(c, pl) Then
                            pl = c
                            cont = True
                        End If
                    End If
                End If
            Next k
        End If
        If IsEmpty(pl) Then GoTo NextPress
        late = PlLate(pl)
        If IsEmpty(best) Then
            best = pl: bestEarliest = earliest: bestCont = cont: bestLate = late
        ElseIf (Not late And bestLate) Then
            best = pl: bestEarliest = earliest: bestCont = cont: bestLate = late
        ElseIf late = bestLate Then
            If cont And Not bestCont Then
                best = pl: bestEarliest = earliest: bestCont = cont: bestLate = late
            ElseIf cont = bestCont Then
                If EndsBefore(pl, best) Then
                    best = pl: bestEarliest = earliest: bestCont = cont: bestLate = late
                End If
            End If
        End If
NextPress:
    Next ci
    If IsEmpty(best) Then PlaceRun = False: Exit Function
    CommitPlacement L, lotIdx, p, rp, best, bestEarliest, bestCont, allowedDate
    PlaceRun = True
End Function

Private Sub InsertBooking(ByVal p As Long, ByVal b As Long)
    Dim lo As Long, hi As Long, md As Long, k As Long
    lo = 1: hi = gW(p).bkN + 1
    Do While lo < hi
        md = (lo + hi) \ 2
        If bS(bkIdx(p, md)) < bS(b) Then lo = md + 1 Else hi = md
    Loop
    gW(p).bkN = gW(p).bkN + 1
    If gW(p).bkN > bkCap Then
        bkCap = bkCap * 2
        ReDim Preserve bkIdx(1 To gWN + 1, 1 To bkCap)
    End If
    For k = gW(p).bkN To lo + 1 Step -1
        bkIdx(p, k) = bkIdx(p, k - 1)
    Next k
    bkIdx(p, lo) = b
End Sub

Private Function NewBooking() As Long
    bN = bN + 1
    If bN > UBound(bS) Then
        ReDim Preserve bS(1 To bN * 2): ReDim Preserve bE(1 To bN * 2): ReDim Preserve bMat(1 To bN * 2)
        ReDim Preserve bNoSetup(1 To bN * 2): ReDim Preserve bSetupIf(1 To bN * 2): ReDim Preserve bEarliest(1 To bN * 2)
        ReDim Preserve bAdded(1 To bN * 2): ReDim Preserve bLT(1 To bN * 2): ReDim Preserve bJob(1 To bN * 2)
    End If
    NewBooking = bN
End Function

Private Sub AddHall(ByVal hall As String, ByVal typ As Long, ByVal d As Long, ByVal s As Double, ByVal e As Double, ByVal pname As String)
    hlN = hlN + 1
    If hlN > UBound(hlS) Then
        ReDim Preserve hlHall(1 To hlN * 2): ReDim Preserve hlType(1 To hlN * 2): ReDim Preserve hlDate(1 To hlN * 2): ReDim Preserve hlS(1 To hlN * 2)
        ReDim Preserve hlE(1 To hlN * 2): ReDim Preserve hlPress(1 To hlN * 2): ReDim Preserve hlNext(1 To hlN * 2)
    End If
    hlHall(hlN) = hall: hlType(hlN) = typ: hlDate(hlN) = d: hlS(hlN) = s: hlE(hlN) = e: hlPress(hlN) = pname
    ' index by production day (only the day and its neighbours are ever read)
    hlNext(hlN) = hlHead(HallDay(d))
    hlHead(HallDay(d)) = hlN
End Sub

Private Sub AddMold(ByVal mat As String, ByVal d As Long, ByVal p As Long, ByVal s As Double, ByVal e As Double)
    muN = muN + 1
    If muN > UBound(muS) Then
        ReDim Preserve muMat(1 To muN * 2): ReDim Preserve muDate(1 To muN * 2): ReDim Preserve muPress(1 To muN * 2)
        ReDim Preserve muS(1 To muN * 2): ReDim Preserve muE(1 To muN * 2): ReDim Preserve muNext(1 To muN * 2)
    End If
    muMat(muN) = mat: muDate(muN) = d: muPress(muN) = p: muS(muN) = s: muE(muN) = e
    ' per material list in insertion order
    Dim pix As Long
    pix = ProdOf(mat)
    muNext(muN) = 0
    If muTail(pix) = 0 Then muHead(pix) = muN Else muNext(muTail(pix)) = muN
    muTail(pix) = muN
End Sub

Private Sub AddSeg(ByVal kind As Long, ByVal d As Long, ByVal s As Double, ByVal e As Double)
    sgN = sgN + 1
    If sgN > UBound(sgS) Then
        ReDim Preserve sgKind(1 To sgN * 2): ReDim Preserve sgDate(1 To sgN * 2)
        ReDim Preserve sgS(1 To sgN * 2): ReDim Preserve sgE(1 To sgN * 2)
    End If
    sgKind(sgN) = kind: sgDate(sgN) = d: sgS(sgN) = s: sgE(sgN) = e
End Sub

Private Sub CommitPlacement(ByVal L As Long, ByVal lotIdx As Long, ByVal p As Long, ByVal rp As Variant, ByVal best As Variant, _
                            ByVal bestEarliest As Double, ByVal cont As Boolean, ByVal allowedDate As Long)
    Dim pr As Long, b As Long, segs As Variant, n As Long, k As Long, j As Long
    pr = best(0)
    b = NewBooking()
    bS(b) = best(4): bE(b) = best(5): bMat(b) = gLot(L).mat: bNoSetup(b) = best(6)
    bSetupIf(b) = rp(5): bEarliest(b) = bestEarliest: bAdded(b) = 0: bLT(b) = gLot(L).lt
    InsertBooking pr, b
    ' follow setup: the next job (set up for free before) gets its setup back
    If Not IsEmpty(best(13)) Then
        Dim nxK As Long, nx As Long
        nxK = FirstEndAfter(pr, best(5))
        If nxK <= gW(pr).bkN Then
            nx = bkIdx(pr, nxK)
            If nx <> b And bNoSetup(nx) And bMat(nx) <> gLot(L).mat Then
                bS(nx) = best(13)(0)
                bNoSetup(nx) = False
                bAdded(nx) = best(13)(3)
            End If
        End If
    End If
    ' hall log
    If Not IsEmpty(best(10)) Then
        AddHall gW(pr).hall, 1, best(10)(0), best(10)(1), best(10)(2), gW(pr).pname
    End If
    For k = 1 To best(12)
        AddHall gW(pr).hall, 2, best(11)(0)(k), best(11)(1)(k), best(11)(2)(k), gW(pr).pname
    Next k
    If Not IsEmpty(best(13)) Then
        AddHall gW(pr).hall, 1, best(13)(1), best(13)(2), best(13)(2) + best(13)(3), gW(pr).pname
    End If
    ' mould usage per date (dieSpans)
    segs = best(8)
    n = best(9)
    Dim firstD As Long, lastD As Long, d As Long, s As Double, e As Double, has As Boolean
    firstD = segs(1)(1): lastD = segs(1)(1)
    For k = 1 To n
        If segs(1)(k) < firstD Then firstD = segs(1)(k)
        If segs(1)(k) > lastD Then lastD = segs(1)(k)
    Next k
    For d = firstD To lastD
        s = 1E+300: e = -1E+300: has = False
        For k = 1 To n
            If segs(1)(k) = d Then
                has = True
                If segs(2)(k) < s Then s = segs(2)(k)
                If segs(3)(k) > e Then e = segs(3)(k)
            End If
        Next k
        If firstD <> lastD Then
            If Not (d = firstD And has) Then s = DAY_OPEN
            If Not (d = lastD And has) Then e = DAY_CLOSE
        End If
        If has Or firstD <> lastD Then AddMold gLot(L).mat, d, pr, s, e
    Next d
    ' job
    gJobN = gJobN + 1
    If gJobN > UBound(gJob) Then
        ReDim Preserve gJob(1 To gJobN * 2)
    End If
    gStep = gStep + 1
    bJob(b) = gJobN
    With gJob(gJobN)
        .mat = gLot(L).mat
        .press = pr
        .lot = L
        .qty = rp(0)
        If best(6) Then .setupMin = 0 Else .setupMin = rp(5)
        .qaMin = rp(6)
        .runMin = rp(7)
        .coils = rp(2)
        .segFirst = sgN + 1
        .segN = n
        .preFirst = 0
        .preN = 0
        .urgentSetup = best(14)
        .continued = best(6)
        .allowed = allowedDate
        .seq = gStep
    End With
    For k = 1 To n
        AddSeg segs(0)(k), segs(1)(k), segs(2)(k), segs(3)(k)
    Next k
    Dim rD As Long, rM As Double, dD As Long, dN As Double
    gJob(gJobN).late = Delivery(L, sgKind, sgDate, sgS, sgE, gJob(gJobN).segFirst, n, rD, rM, dD, dN)
    gJob(gJobN).readyDate = rD
    gJob(gJobN).readyMin = rM
    gJob(gJobN).dlDate = dD
    gJob(gJobN).dlNet = dN
    If gJob(gJobN).late Then
        gJob(gJobN).lateMin = CDbl(rD - dD) * 1440 + (rM - dN)
        If gJob(gJobN).lateMin < 0 Then gJob(gJobN).lateMin = 0
    Else
        gJob(gJobN).lateMin = 0
    End If
    gJob(gJobN).reason = ReasonOf(L, p, rp)
End Sub

Private Function ReasonOf(ByVal L As Long, ByVal p As Long, ByVal rp As Variant) As String
    Dim s As String
    Select Case gLot(L).phase
        Case PH_BACKLOG
            s = "Backlog " & Format$(gLot(L).qty, "0") & " pcs"
        Case PH_URGENT
            s = "Stock runs out " & IsoTxt(gLot(L).due) & " - below safety stock now"
        Case Else
            s = gLot(L).bucket & ": stock runs out " & IsoTxt(gLot(L).due) & ", may start " & IsoTxt(gLot(L).earliest)
    End Select
    If rp(2) = 0 Then
        If gP(p).minLot > 0 Then
            s = s & " | min. lot " & Format$(gP(p).minLot, "0") & " pcs"
        ElseIf gP(p).cycle > 0 Then
            s = s & " | exact quantity (cycle time, no coil)"
        Else
            s = s & " | no Min. lot and no coil weight in master data - exact quantity"
        End If
    ElseIf rp(2) = 1 Then
        s = s & " | 1 full coil"
    Else
        s = s & " | " & rp(2) & " full coils"
    End If
    If gLot(L).lt Then s = s & " | long-term (weekly ZPP)"
    If gLot(L).boost Then s = s & " | moved forward by late-job repair"
    ReasonOf = s
End Function

' Jobs whose setup came back because another die entered the gap before them.
Private Sub ApplyAddedSetups()
    Dim b As Long, j As Long, p As Long, k As Long, n As Long
    For b = 1 To bN
        If bAdded(b) > 0 And bJob(b) > 0 Then
            j = bJob(b)
            p = gJob(j).press
            tN = 0
            ReDim tKind(1 To 4): ReDim tDate(1 To 4): ReDim tS(1 To 4): ReDim tE(1 To 4)
            DatedSegments p, K_SETUP, bS(b), bS(b) + bAdded(b)
            If tN > 0 Then
                gJob(j).preFirst = sgN + 1
                gJob(j).preN = tN
                For k = 1 To tN
                    AddSeg tKind(k), tDate(k), tS(k), tE(k)
                Next k
                gJob(j).setupMin = gJob(j).setupMin + bAdded(b)
                gJob(j).continued = False
                gJob(j).reason = gJob(j).reason & " | setup needed again: another die runs on this work center before it"
            End If
        End If
    Next b
End Sub

' =====================================================================================
' Output
' =====================================================================================
Private Sub ClearSheet(ByVal sheetName As String)
    Dim ws As Object, lastRow As Long, lastCol As Long
    Set ws = Sh(sheetName)
    lastRow = ws.Cells(ws.Rows.Count, 1).End(-4162).Row
    lastCol = ws.Cells(1, ws.Columns.Count).End(-4159).Column
    If lastCol < 30 Then lastCol = 30
    If lastRow >= 2 Then ws.Range(ws.Cells(2, 1), ws.Cells(lastRow + 1, lastCol)).ClearContents
End Sub

Private Function PhaseName(ByVal ph As Long) As String
    Select Case ph
        Case PH_BACKLOG: PhaseName = "backlog"
        Case PH_URGENT: PhaseName = "urgent"
        Case Else: PhaseName = "fill"
    End Select
End Function

' production day + net minute -> calendar date-time (clock), for a press-day with n shifts
Private Function MomentOf(ByVal d As Long, ByVal net As Double, ByVal n As Long, ByVal atEnd As Boolean) As Double
    MomentOf = CDbl(d) + NetToClock(net, n, atEnd) / 1440#
End Function

Private Function ShiftsOn(ByVal p As Long, ByVal d As Long) As Long
    Dim k As Long
    For k = gW(p).dayFirst To gW(p).dayFirst + gW(p).dayN - 1
        If dyDate(k) = d Then ShiftsOn = dyShifts(k): Exit Function
    Next k
    ShiftsOn = 3
End Function

Private Sub WriteOutputs(ByVal seconds As Double)
    Dim ws As Object, out() As Variant, L As Long, k As Long, r As Long, j As Long, cps As String
    ' ---- Lots
    ClearSheet "Lots"
    Set ws = Sh("Lots")
    If gBaseLotN > 0 Then
        ReDim out(1 To gBaseLotN, 1 To 13)
        For L = 1 To gBaseLotN
            out(L, 1) = L
            out(L, 2) = gBaseLot(L).mat
            out(L, 3) = gBaseLot(L).bucket
            out(L, 4) = gBaseLot(L).qty
            out(L, 5) = gBaseLot(L).rule
            out(L, 6) = PhaseName(gBaseLot(L).phase)
            out(L, 7) = IIf(gBaseLot(L).lt, "Y", "")
            out(L, 8) = CDate(gBaseLot(L).due)
            out(L, 9) = CDate(gBaseLot(L).earliest)
            If gBaseLot(L).noSO Or gBaseLot(L).lt Then
                out(L, 10) = "not checked"
            Else
                out(L, 10) = CDate(MomentOf(gBaseLot(L).dlDate, gBaseLot(L).dlNet, 3, True))
            End If
            out(L, 11) = Round(gBaseLot(L).needF, 4)
            cps = ""
            For k = gBaseLot(L).cpFirst To gBaseLot(L).cpFirst + gBaseLot(L).cpN - 1
                If cps <> "" Then cps = cps & "; "
                cps = cps & Format$(CDate(cpDate(k)), "dd.mm") & " " & Format$(cpFrac(k) * 100, "0") & "%"
            Next k
            out(L, 12) = cps
            out(L, 13) = IIf(gBaseLot(L).noSO, "stock never runs out in horizon", "")
        Next L
        ws.Range(ws.Cells(2, 1), ws.Cells(gBaseLotN + 1, 13)).Value = out
    End If
    ' ---- Production plan, ordered by work center and start
    ClearSheet "Production Plan"
    Set ws = Sh("Production Plan")
    If gJobN > 0 Then
        Dim ord() As Long, a As Long, b As Long, tmp As Long
        ReDim ord(1 To gJobN)
        For j = 1 To gJobN
            ord(j) = j
        Next j
        For a = 2 To gJobN
            tmp = ord(a)
            b = a - 1
            Do While b >= 1
                If JobAfter(ord(b), tmp) Then
                    ord(b + 1) = ord(b)
                    b = b - 1
                Else
                    Exit Do
                End If
            Loop
            ord(b + 1) = tmp
        Next a
        ReDim out(1 To gJobN, 1 To 22)
        For r = 1 To gJobN
            j = ord(r)
            Dim fs As Long, fsN As Long, prodS As Double, endM As Double, setS As Double, n As Long, pr As Long
            pr = gJob(j).press
            out(r, 1) = r
            out(r, 2) = gW(pr).pname
            out(r, 3) = gW(pr).hall
            out(r, 4) = gJob(j).mat
            out(r, 5) = gLot(gJob(j).lot).bucket
            out(r, 6) = PhaseName(gLot(gJob(j).lot).phase)
            out(r, 7) = gJob(j).qty
            out(r, 8) = gJob(j).coils
            ' setup start = first segment (added setup first)
            If gJob(j).preN > 0 Then
                fs = gJob(j).preFirst
            Else
                fs = gJob(j).segFirst
            End If
            out(r, 9) = CDate(MomentOf(sgDate(fs), sgS(fs), ShiftsOn(pr, sgDate(fs)), False))
            out(r, 10) = Round(gJob(j).setupMin, 1)
            out(r, 11) = Round(gJob(j).qaMin, 1)
            ' production start = first run segment
            prodS = 0
            For k = gJob(j).segFirst To gJob(j).segFirst + gJob(j).segN - 1
                If sgKind(k) = K_RUN Then
                    out(r, 12) = CDate(MomentOf(sgDate(k), sgS(k), ShiftsOn(pr, sgDate(k)), False))
                    prodS = 1
                    Exit For
                End If
            Next k
            k = gJob(j).segFirst + gJob(j).segN - 1
            out(r, 13) = CDate(MomentOf(sgDate(k), sgE(k), ShiftsOn(pr, sgDate(k)), True))
            out(r, 14) = Round(gJob(j).runMin, 1)
            Dim occupied As Double
            occupied = 0
            For k = gJob(j).segFirst To gJob(j).segFirst + gJob(j).segN - 1
                occupied = occupied + sgE(k) - sgS(k)
            Next k
            For k = gJob(j).preFirst To gJob(j).preFirst + gJob(j).preN - 1
                If gJob(j).preN > 0 Then occupied = occupied + sgE(k) - sgS(k)
            Next k
            out(r, 15) = Round(occupied, 1)
            If gJob(j).dlDate > 0 Then
                out(r, 16) = CDate(MomentOf(gJob(j).dlDate, gJob(j).dlNet, 3, True))
            Else
                out(r, 16) = "not checked"
            End If
            If gJob(j).readyDate > 0 Then out(r, 17) = CDate(MomentOf(gJob(j).readyDate, gJob(j).readyMin, ShiftsOn(pr, gJob(j).readyDate), True))
            out(r, 18) = IIf(gJob(j).late, "LATE", "")
            If gJob(j).late Then out(r, 19) = Round(gJob(j).lateMin / 60, 1)
            out(r, 20) = IIf(gJob(j).continued, "no setup (same die)", IIf(gJob(j).urgentSetup, "urgent setup rule", ""))
            out(r, 21) = gJob(j).reason
            out(r, 22) = gJob(j).seq
        Next r
        ws.Range(ws.Cells(2, 1), ws.Cells(gJobN + 1, 22)).Value = out
    End If
    ' ---- Unplanned
    ClearSheet "Unplanned"
    Set ws = Sh("Unplanned")
    If gUnN > 0 Then
        ReDim out(1 To gUnN, 1 To 6)
        For r = 1 To gUnN
            out(r, 1) = gUn(r).mat
            out(r, 2) = gUn(r).bucket
            out(r, 3) = gUn(r).qty
            out(r, 4) = PhaseName(gUn(r).phase) & IIf(gUn(r).lt, " (long-term)", "")
            out(r, 5) = CDate(gUn(r).due)
            out(r, 6) = gUn(r).reason
        Next r
        ws.Range(ws.Cells(2, 1), ws.Cells(gUnN + 1, 6)).Value = out
    End If
    gStage = "load": WriteLoad
    gStage = "check": WriteCheck False
    Set ws = Sh("Check")
    ws.Cells(1, 4).Value = "Run at " & Format$(Now, "yyyy-mm-dd hh:mm") & " in " & Format$(seconds, "0.0") & " s"
End Sub

Private Function JobAfter(ByVal a As Long, ByVal b As Long) As Boolean
    Dim fa As Long, fb As Long
    If gW(gJob(a).press).pname <> gW(gJob(b).press).pname Then
        JobAfter = (gJob(a).press > gJob(b).press)
        Exit Function
    End If
    If gJob(a).preN > 0 Then fa = gJob(a).preFirst Else fa = gJob(a).segFirst
    If gJob(b).preN > 0 Then fb = gJob(b).preFirst Else fb = gJob(b).segFirst
    If sgDate(fa) <> sgDate(fb) Then JobAfter = (sgDate(fa) > sgDate(fb)): Exit Function
    JobAfter = (sgS(fa) > sgS(fb))
End Function

Private Sub WriteLoad()
    Dim ws As Object, out() As Variant, p As Long, w As Long, k As Long, cap As Double, used As Double, r As Long
    ClearSheet "Load"
    Set ws = Sh("Load")
    If gWN = 0 Then Exit Sub
    ReDim out(1 To gWN * gH, 1 To 7)
    For p = 1 To gWN
        For w = 0 To gH - 1
            r = r + 1
            cap = 0: used = 0
            For k = gW(p).dayFirst To gW(p).dayFirst + gW(p).dayN - 1
                If dyDate(k) >= gBase + w * 7 And dyDate(k) <= gBase + w * 7 + 6 Then cap = cap + dyCap(k)
            Next k
            used = UsedMinutes(p, gBase + w * 7, gBase + w * 7 + 6)
            out(r, 1) = gW(p).pname
            out(r, 2) = gW(p).hall
            out(r, 3) = CDate(gBase + w * 7)
            out(r, 4) = Round(cap / 60, 1)
            out(r, 5) = Round(used / 60, 1)
            If cap > 0 Then out(r, 6) = Round(used / cap, 3) Else out(r, 6) = ""
            out(r, 7) = Round((cap - used) / 60, 1)
        Next w
    Next p
    ws.Range(ws.Cells(2, 1), ws.Cells(gWN * gH + 1, 7)).Value = out
End Sub

Private Function UsedMinutes(ByVal p As Long, ByVal d1 As Long, ByVal d2 As Long) As Double
    Dim j As Long, k As Long
    For j = 1 To gJobN
        If gJob(j).press = p Then
            For k = gJob(j).segFirst To gJob(j).segFirst + gJob(j).segN - 1
                If sgDate(k) >= d1 And sgDate(k) <= d2 Then UsedMinutes = UsedMinutes + sgE(k) - sgS(k)
            Next k
            If gJob(j).preN > 0 Then
                For k = gJob(j).preFirst To gJob(j).preFirst + gJob(j).preN - 1
                    If sgDate(k) >= d1 And sgDate(k) <= d2 Then UsedMinutes = UsedMinutes + sgE(k) - sgS(k)
                Next k
            End If
        End If
    Next j
End Function

' =====================================================================================
' Check sheet: independent checks of the result and of the master data
' =====================================================================================
Private Sub CheckRow(ByRef out() As Variant, ByRef r As Long, ByVal area As String, ByVal status As String, ByVal detail As String)
    r = r + 1
    If r > UBound(out, 1) Then Exit Sub
    out(r, 1) = area
    out(r, 2) = status
    out(r, 3) = detail
End Sub

' Writes the first n rows of a 3-column result array (the range and the array
' must have the same size in every host).
Private Sub PutRows(ByVal ws As Object, ByRef out() As Variant, ByVal n As Long)
    Dim res() As Variant, i As Long, c As Long
    If n < 1 Then Exit Sub
    If n > UBound(out, 1) Then n = UBound(out, 1)
    ReDim res(1 To n, 1 To 3)
    For i = 1 To n
        For c = 1 To 3
            res(i, c) = out(i, c)
        Next c
    Next i
    ws.Range(ws.Cells(2, 1), ws.Cells(n + 1, 3)).Value = res
End Sub

Private Sub WriteCheck(ByVal dataOnly As Boolean)
    Dim ws As Object, out() As Variant, r As Long, i As Long, j As Long, k As Long, p As Long, msg As String
    ClearSheet "Check"
    Set ws = Sh("Check")
    ReDim out(1 To 3000, 1 To 3)
    ' ---- master data and inputs
    gStage = "check 1"
    Dim nProblems As Long
    For i = 1 To gMatN
        p = ProdOf(gMat(i))
        If p = 0 Then
            CheckRow out, r, "Master data", "ERROR", gMat(i) & ": has demand but no Master Data row - it cannot be planned."
            nProblems = nProblems + 1
        Else
            If MinutesPerPiece(p) <= 0 Then
                CheckRow out, r, "Master data", "ERROR", gMat(i) & ": no cycle time (min/pc) and no SPM - its run time is 0."
                nProblems = nProblems + 1
            End If
            If gP(p).main = "" Then
                CheckRow out, r, "Master data", "ERROR", gMat(i) & ": no main work center."
                nProblems = nProblems + 1
            ElseIf ColIndex(gPressIdx, gP(p).main) = 0 Then
                CheckRow out, r, "Master data", "ERROR", gMat(i) & ": main work center " & gP(p).main & " is not on the Work Centers sheet."
                nProblems = nProblems + 1
            End If
            If LotRule(p) = "missing" And gP(p).cycle <= 0 Then
                CheckRow out, r, "Master data", "WARNING", gMat(i) & ": no Min. lot and no coil weight / gross weight - lot = exact need."
            End If
            If gP(p).coProd <> "" Then
                CheckRow out, r, "Master data", "WARNING", gMat(i) & ": co-product " & gP(p).coProd & " is not modelled in Excel - both are planned separately (the website plans them in one stroke)."
            End If
            If gP(p).perf > 1 Then
                CheckRow out, r, "Master data", "WARNING", gMat(i) & ": performance factor > 1 is treated as 1."
            End If
        End If
    Next i
    For p = 1 To gWN
        If gW(p).hall = "" Then CheckRow out, r, "Work centers", "WARNING", gW(p).pname & ": no hall - setups are limited together with every other work center without a hall."
        If gW(p).total <= 0 Then CheckRow out, r, "Work centers", "WARNING", gW(p).pname & ": no working time in the horizon."
    Next p
    If gMatN = 0 Then CheckRow out, r, "Demand", "ERROR", "ZPP and ZPP_DAILY are empty - nothing to plan."
    If gDailyUntil > 0 And gDailyUntil < gPlanDate Then CheckRow out, r, "Demand", "WARNING", "ZPP_DAILY ends " & IsoTxt(gDailyUntil) & ", before the plan date - it is not used."
    For i = 1 To gWarn.Count
        CheckRow out, r, "Inputs", "INFO", gWarn.Item(i)
    Next i
    If nProblems = 0 Then CheckRow out, r, "Master data", "OK", "Every material with demand has a master data row, a run time and a known main work center."
    If dataOnly Then
        PutRows ws, out, r
        Exit Sub
    End If
    ' ---- result checks (computed again from the job segments)
    gStage = "check 2"
    Dim overlaps As Long, outside As Long
    For p = 1 To gWN
        Dim segP() As Long, nS As Long
        nS = 0
        ReDim segP(1 To sgN + 1)
        For j = 1 To gJobN
            If gJob(j).press = p Then
                For k = gJob(j).segFirst To gJob(j).segFirst + gJob(j).segN - 1
                    nS = nS + 1: segP(nS) = k
                Next k
                If gJob(j).preN > 0 Then
                    For k = gJob(j).preFirst To gJob(j).preFirst + gJob(j).preN - 1
                        nS = nS + 1: segP(nS) = k
                    Next k
                End If
            End If
        Next j
        For i = 1 To nS
            ' inside the working time of that day
            Dim di As Long, okDay As Boolean
            okDay = False
            For di = gW(p).dayFirst To gW(p).dayFirst + gW(p).dayN - 1
                If dyDate(di) = sgDate(segP(i)) Then
                    If sgS(segP(i)) >= dyStartNet(di) - 0.000001 And sgE(segP(i)) <= dyStartNet(di) + dyCap(di) + 0.000001 Then okDay = True
                End If
            Next di
            If Not okDay Then outside = outside + 1
            For k = i + 1 To nS
                If sgDate(segP(i)) = sgDate(segP(k)) Then
                    If sgS(segP(i)) < sgE(segP(k)) - 0.000001 And sgS(segP(k)) < sgE(segP(i)) - 0.000001 Then overlaps = overlaps + 1
                End If
            Next k
        Next i
    Next p
    CheckRow out, r, "Result", IIf(overlaps = 0, "OK", "ERROR"), "Overlapping pieces on the same work center: " & overlaps
    CheckRow out, r, "Result", IIf(outside = 0, "OK", "ERROR"), "Pieces outside the working time of their day: " & outside
    ' quantities: lots = planned + unplanned
    Dim sumLots As Double, sumJobs As Double, sumUn As Double
    For i = 1 To gBaseLotN
        sumLots = sumLots + gBaseLot(i).qty
    Next i
    For j = 1 To gJobN
        sumJobs = sumJobs + gJob(j).qty
    Next j
    For j = 1 To gUnN
        sumUn = sumUn + gUn(j).qty
    Next j
    CheckRow out, r, "Result", IIf(Abs(sumLots - sumJobs - sumUn) < 0.5, "OK", "ERROR"), _
             "Lot quantity " & Format$(sumLots, "#,##0") & " = planned " & Format$(sumJobs, "#,##0") & " + unplanned " & Format$(sumUn, "#,##0")
    ' run time of each job = cycle time x quantity (rateModel)
    Dim badRun As Long, runSum As Double
    For j = 1 To gJobN
        runSum = 0
        For k = gJob(j).segFirst To gJob(j).segFirst + gJob(j).segN - 1
            If sgKind(k) = K_RUN Then runSum = runSum + sgE(k) - sgS(k)
        Next k
        If Abs(runSum - gJob(j).runMin) > 0.01 Then badRun = badRun + 1
        p = ProdOf(gJob(j).mat)
        If p > 0 Then
            If gJob(j).runMin < RunMinutesFor(p, gJob(j).qty) - 0.01 Then badRun = badRun + 1
        End If
    Next j
    CheckRow out, r, "Result", IIf(badRun = 0, "OK", "ERROR"), "Jobs whose run time differs from quantity x cycle time (or is faster than it): " & badRun
    ' setups in the same hall (normal rule) and plant-wide
    Dim maxPlant As Long, cnt As Long
    For i = 1 To hlN
        If hlType(i) = 1 Then
            cnt = 0
            For k = 1 To hlN
                If hlType(k) = 1 And PlantAt(hlDate(k), hlS(k)) <= PlantAt(hlDate(i), hlS(i)) + 0.000001 And PlantAt(hlDate(k), hlE(k)) > PlantAt(hlDate(i), hlS(i)) + 0.000001 Then cnt = cnt + 1
            Next k
            If cnt > maxPlant Then maxPlant = cnt
        End If
    Next i
    CheckRow out, r, "Result", IIf(maxPlant <= gCapUrgent, "OK", "ERROR"), _
             "Most die setups at the same moment in the plant: " & maxPlant & " (limit " & gCapNormal & " normal, " & gCapUrgent & " for backlog / late jobs)"
    ' coverage per material: stock + lots >= horizon demand
    Dim shortQ As Long, lateMats As Long
    For i = 1 To gMatN
        Dim dem As Double, sup As Double, w As Long
        dem = gOverdue(i)
        For w = 0 To gH - 1
            dem = dem + gWeekly(i, w)
        Next w
        If gHasDaily(i) Then
            ' the daily file replaces the weekly figure on its days: compare with lots only
            dem = 0
        End If
        sup = gStock(i)
        For k = 1 To gBaseLotN
            If gBaseLot(k).mat = gMat(i) Then sup = sup + gBaseLot(k).qty
        Next k
        If dem > 0 And sup + 0.5 < dem Then
            shortQ = shortQ + 1
            CheckRow out, r, "Coverage", "ERROR", gMat(i) & ": stock + lots " & Format$(sup, "#,##0") & " < demand " & Format$(dem, "#,##0")
        End If
    Next i
    CheckRow out, r, "Coverage", IIf(shortQ = 0, "OK", "ERROR"), "Materials whose stock + lots do not cover the weekly ZPP demand: " & shortQ
    Dim lateList As String, lateN As Long
    For j = 1 To gJobN
        If gJob(j).late Then
            lateN = lateN + 1
            If lateN <= 30 Then lateList = lateList & IIf(lateList = "", "", ", ") & gJob(j).mat & " (" & Format$(gJob(j).lateMin / 60, "0.0") & " h)"
        End If
    Next j
    CheckRow out, r, "Delivery", IIf(lateN = 0, "OK", "LATE"), "Late jobs: " & lateN & IIf(lateN > 0, " - " & lateList, "")
    CheckRow out, r, "Delivery", IIf(gUnN = 0, "OK", "UNPLANNED"), "Unplanned items: " & gUnN & " (see the Unplanned sheet)"
    PutRows ws, out, r
End Sub
