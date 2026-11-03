/**
 * Excel planning module ↔ website engine comparison (manual tool).
 *
 * Runs the website's computePlan on tools/excel/example.json (the data of
 * PlanningExpert_Planlama_Ornek.xlsm) and compares it job by job with the
 * Production Plan sheet the Excel macro wrote. Skipped unless EXCEL_RESULT
 * points to that result (an .xlsx saved after "Run plan"), so CI never needs
 * Excel or LibreOffice:
 *
 *   /usr/bin/python3 tools/excel/run_in_libreoffice.py docs/excel/PlanningExpert_Planlama_Ornek.xlsm /tmp/out.xlsx
 *   python3 tools/excel/read_result.py /tmp/out.xlsx > /tmp/out.json
 *   EXCEL_RESULT=/tmp/out.json npx vitest run tools/excel/engine-compare.test.ts
 *
 * EXCEL_SCENARIOS=1 (default) plans the website side without scenario search,
 * the setting the Excel port follows; EXCEL_SCENARIOS=100 shows how far the
 * website's own best plan is from it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computePlan, type PlanInputs } from '../../src/lib/planPipeline'
import { buildDayTimeline, netToClock } from '../../src/lib/shiftTimeline'
import { SETTINGS_DEFAULTS } from '../../src/lib/settingsDefaults'

type Example = {
  planDate: string
  master: (string | number)[][]
  presses: (string | number)[][]
  stops: (string | number)[][]
  holidays: string[][]
  dayShifts: (string | number)[][]
  locations: string[][]
  stock: (string | number)[][]
  weeks: string[]
  zpp: (string | number)[][]
  dailyDates: string[]
  daily: (string | number)[][]
}

type ExcelJob = {
  press: string
  material: string
  bucket: string
  qty: number
  setupStart: string
  end: string
  setupMinutes: number
  late: boolean
}

const resultPath = process.env.EXCEL_RESULT

const num = (v: string | number) => (typeof v === 'number' ? v : Number(v) || 0)
const opt = (v: string | number) => (num(v) > 0 ? num(v) : undefined)
const txt = (v: string | number) => (String(v ?? '').trim() || undefined)
const clockMinutes = (hhmm: string) => Number(hhmm.split(':')[0]) * 60 + Number(hhmm.split(':')[1])
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`

function inputsOf(ex: Example, maxScenarios: number): PlanInputs {
  return {
    products: ex.master.map((r) => ({
      code: String(r[0]),
      mainMachine: txt(r[2]),
      altMachine1: txt(r[3]),
      altMachine2: txt(r[4]),
      altMachine3: txt(r[5]),
      altMachine4: txt(r[6]),
      flexiblePress: String(r[7]).toUpperCase() === 'Y',
      cycleMinutes: opt(r[8]),
      spm: opt(r[9]),
      moldCavities: opt(r[10]),
      grossWeight: opt(r[11]),
      coilWeight: opt(r[12]),
      minLotQty: opt(r[13]),
      setupMinutes: opt(r[14]),
      coilSetupMinutes: opt(r[15]),
      qualityApprovalMinutes: opt(r[16]),
      performanceFactor: opt(r[17]),
      maxShots: opt(r[18]),
    })),
    weeklyDemand: ex.zpp.map((r) => ({
      material: String(r[0]),
      overdue: num(r[1]),
      periods: ex.weeks.map((label, i) => ({ label, qty: num(r[2 + i] ?? 0) })),
    })),
    dailyDemand: ex.daily.map((r) => ({
      material: String(r[0]),
      periods: ex.dailyDates.map((d, i) => ({ label: dmy(d), qty: num(r[1 + i] ?? 0) })),
    })),
    stock: ex.stock.map((r) => ({ material: String(r[0]), storageLocation: String(r[2]), unrestricted: num(r[3]), uploadedAt: 0 })),
    locations: ex.locations.map((r) => ({ code: r[0], countFinished: r[1] === 'Y' })),
    presses: ex.presses.map((r) => ({ name: String(r[0]), hall: String(r[1]), feedsCoil: r[2] === 'Y' })),
    templates: ex.presses.map((r) => ({ press: String(r[0]), workingDays: num(r[3]), shiftsPerDay: num(r[4]) })),
    pressDayShifts: ex.dayShifts.map((r) => ({
      press: String(r[0]),
      date: String(r[1]),
      shifts: Array.from({ length: num(r[2]) }, (_, i) => i + 1),
    })),
    settings: { maxScenarios },
    workCalendar: { holidays: [] },
    officialHolidays: ex.holidays.map((h) => ({ date: h[0], name: h[1] })),
    latestSnapshot: null,
    plannedStops: ex.stops.map((s) => ({
      shiftIndex: num(s[0]),
      name: String(s[1]),
      kind: String(s[2]),
      startMinute: clockMinutes(String(s[3])),
      durationMinutes: num(s[4]),
    })),
    overrides: [],
    moldMaintenance: [],
    readiness: [],
    pressMaintenance: [],
    alarms: [],
    truncatedInputs: [],
  }
}

describe.skipIf(!resultPath)('Excel planning module = website engine (example data)', () => {
  it('plans the same jobs', () => {
    const ex = JSON.parse(readFileSync(process.env.EXCEL_EXAMPLE ?? new URL('./example.json', import.meta.url), 'utf8')) as Example
    const excel = JSON.parse(readFileSync(resultPath!, 'utf8')) as { jobs: ExcelJob[]; unplanned: unknown[]; lateHours?: number }
    const maxScenarios = Number(process.env.EXCEL_SCENARIOS ?? 1)
    const [y, m, d] = ex.planDate.split('-').map(Number)
    const now = Date.UTC(y, m - 1, d, 0, SETTINGS_DEFAULTS.shiftStartMinute)
    const run = computePlan(inputsOf(ex, maxScenarios), now)

    const shiftsOf = (press: string, date: string): number => {
      const ds = ex.dayShifts.find((r) => r[0] === press && r[1] === date)
      if (ds) return num(ds[2])
      if (ex.holidays.some((h) => h[0] === date)) return 0
      const p = ex.presses.find((r) => r[0] === press)!
      const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
      return weekday < num(p[3]) ? num(p[4]) : 0
    }
    const stops = inputsOf(ex, 1).plannedStops
    const clock = (press: string, date: string, net: number, atEnd: boolean) => {
      const tl = buildDayTimeline(SETTINGS_DEFAULTS.shiftStartMinute, SETTINGS_DEFAULTS.shiftMinutes, shiftsOf(press, date), stops)
      // an end on a segment boundary belongs to the segment it closes (not the next one after a break)
      const c = atEnd && net > 0 ? netToClock(net - 1e-6, tl) + 1e-6 : netToClock(net, tl)
      const t = new Date(`${date}T00:00:00Z`).getTime() + Math.round(c) * 60_000
      return new Date(t).toISOString().slice(0, 16).replace('T', ' ')
    }
    if (process.env.EXCEL_DEBUG) {
      for (const j of run.jobs.filter((x) => x.material === process.env.EXCEL_DEBUG)) {
        console.log(j.press, j.bucketLabel, j.quantity, JSON.stringify(j.segments))
      }
    }
    const site = run.jobs
      .filter((j) => !j.material.startsWith('⚙'))
      .map((j) => {
        const first = j.segments[0]
        const last = j.segments[j.segments.length - 1]
        return {
          press: j.press,
          material: j.material,
          bucket: j.bucketLabel,
          qty: j.quantity,
          setupStart: clock(j.press, first.date, first.start, false),
          end: clock(j.press, last.date, last.end, true),
          setupMinutes: Math.round(j.setupMinutes * 10) / 10,
          late: j.late,
        }
      })
      .sort((a, b) => a.press.localeCompare(b.press) || a.setupStart.localeCompare(b.setupStart))
    const fmt = (j: ExcelJob) => `${j.press} ${j.material} ${j.bucket} ${j.qty} setup ${j.setupMinutes} ${j.setupStart} → ${j.end}${j.late ? ' LATE' : ''}`
    // same job: identical fields, times within 1 minute (fractional minutes are rounded on both sides)
    const minutes = (t: string) => Date.parse(`${t.replace(' ', 'T')}:00Z`) / 60_000
    const same = (x: ExcelJob, y: ExcelJob) =>
      x.press === y.press && x.material === y.material && x.bucket === y.bucket && Math.abs(x.qty - y.qty) < 0.5 &&
      Math.abs(x.setupMinutes - y.setupMinutes) < 0.05 && x.late === y.late &&
      Math.abs(minutes(x.setupStart) - minutes(y.setupStart)) <= 1 && Math.abs(minutes(x.end) - minutes(y.end)) <= 1
    const onlySite = site.filter((x) => !excel.jobs.some((y) => same(x, y))).map(fmt)
    const onlyExcel = excel.jobs.filter((y) => !site.some((x) => same(x, y))).map(fmt)
    const a = site.map(fmt)
    const b = excel.jobs.map(fmt)
    console.log(`website ${a.length} jobs (${run.unplanned.length} unplanned), Excel ${b.length} jobs (${excel.unplanned.length} unplanned)`)
    type Summary = { label: string; late: number; lateHours: number; unplanned: number }
    const opt = (run as unknown as {
      optimisation?: { chosen?: string; localSearch?: { improvements: number }; scenarios?: Summary[] }
    }).optimisation
    console.log(`website plan: ${opt?.chosen ?? '-'}, local search ${JSON.stringify(opt?.localSearch)}`)
    if ((opt?.localSearch?.improvements ?? 0) > 0) {
      // The website improved its plan with local search, which the Excel port does not
      // have: compare with the website's plan before local search ("Standard").
      const standard = opt?.scenarios?.find((s) => s.label === 'Standard')
      const excelLate = excel.jobs.filter((j) => j.late).length
      const excelLateHours = excel.lateHours ?? 0
      console.log(`website Standard: ${JSON.stringify(standard)}; Excel: late ${excelLate}, late h ${excelLateHours}, unplanned ${excel.unplanned.length}`)
      expect(standard).toBeDefined()
      expect(excelLate).toBe(standard!.late)
      expect(excel.unplanned.length).toBe(standard!.unplanned)
      expect(Math.abs(excelLateHours - standard!.lateHours)).toBeLessThanOrEqual(0.1 * Math.max(1, excelLate))
      return
    }
    if (onlySite.length || onlyExcel.length) console.log(['only website:', ...onlySite, 'only Excel:', ...onlyExcel].join('\n'))
    expect(onlyExcel).toEqual([])
    expect(onlySite).toEqual([])
    expect(excel.unplanned.length).toBe(run.unplanned.length)
  }, 300_000)
})
