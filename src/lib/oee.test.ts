import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import fixtureV2 from './oee.fixture.v2.json'
import {
  EMPTY_CONFIG,
  chartShare,
  chartGroups,
  configProblems,
  costCentersOf,
  daysFromShifts,
  dieTable,
  inScope,
  isoWeek,
  lossDayOf,
  lossForPeriod,
  mondayOfWeek,
  mondayStartProblem,
  parseOeeWorkbook,
  lossCoverage,
  ratios,
  setupAnalysis,
  startupRunOf,
  trendGaps,
  PLANT_AREA,
  areaNames,
  totalsFor,
  withPlantCostCenters,
  forPlantCostCenters,
  sheetKind,
  suggestConfig,
  visibleChartGroups,
  sumTimes,
  weekShiftTrend,
  weekTimes,
  weeklyTrend,
  type OeeConfig,
  type SheetRows,
  type WeeklyRow,
} from './oee'
import { OEE_SUGGESTED } from './settingsDefaults'

// Veri: ASAKAI_2026_REV_12.xlsm'den kesit (Transfer 39. hafta vardiyaları,
// Progressive 21 Eylül vardiya ve duruşları, PRS-110 39. hafta siparişleri).
// Beklenen değerler Excel'in kendi hücrelerinden (BoardReport, Losses_Follow).
const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
const days = daysFromShifts(parsed.shifts)

/** Bu tesisin ayarı — programda değil, kullanıcının Settings sayfasında durur; burada yalnızca test için. */
const plant: OeeConfig = {
  areas: [
    { name: 'PRS', pick: 'costCenter' },
    { name: 'APR', pick: 'machine' },
  ],
  costCenters: [
    { code: '51010171', name: 'Transfer', area: 'PRS' },
    { code: '51010173', name: 'Progressive', area: 'PRS' },
    { code: '51010172', name: 'APR', area: 'APR' },
  ],
  shifts: [
    { code: 'UB61', number: 1 },
    { code: 'UB62', number: 2 },
    { code: 'UB63', number: 3 },
    { code: 'UB64', number: 1 },
    { code: 'UB65', number: 2 },
    { code: 'UB66', number: 3 },
  ],
  lossReasonCodes: ['UNSCD_DOWN', '#'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [
    { code: 'KLP', label: 'Die breakdown', chart: 'Die', breakdown: true },
    { code: 'STP', label: 'Setup', chart: 'Setup', breakdown: false },
    { code: 'ARZ', label: 'Machine breakdown', chart: 'Machine', breakdown: true },
    { code: 'KSD', label: 'Short stoppages', chart: 'Short', breakdown: false },
    { code: 'KON', label: 'Quality', chart: 'Others', breakdown: false },
    { code: 'OFC', label: 'Logistic', chart: 'Others', breakdown: false },
    { code: 'YNT', label: 'Management', chart: 'Others', breakdown: false },
    { code: '#', label: 'Undefined', chart: 'Undefined', breakdown: false },
  ],
  setupTexts: [
    { text: 'DIE SETUP - PLANNED', kind: 'planned' },
    { text: 'DIE SETUP - UNPLANNED', kind: 'unplanned' },
  ],
  startupRunMin: 60,
  trendWeeks: 10,
  topN: 10,
}
const transfer = { area: 'PRS', key: '51010171' }
const progressive = { area: 'PRS', key: '51010173' }

describe('oee workbook', () => {
  it('recognises the sheets by name', () => {
    expect(sheetKind('Daily KPI')).toBe('daily')
    expect(sheetKind('Downtimes (1)')).toBe('downtimes')
    expect(sheetKind('Shiftly Base Order KPI')).toBe('orders')
    expect(sheetKind('BoardReport')).toBeNull()
    expect(parsed.shifts.length).toBe(40)
  })

  it('shift ratios are sum-based and match the file', () => {
    for (const s of parsed.shifts) {
      const r = ratios(s)
      expect(r.availability! * 100).toBeCloseTo(s.availability, 6)
      expect(r.oee! * 100).toBeCloseTo(s.oee, 6)
    }
  })

  it('weekly OEE of Transfer = Weekly KPI / Losses_Follow B6 (sum ÷ sum, not an average)', () => {
    const w = weeklyTrend(days, [], transfer, plant, mondayOfWeek(2026, 39), 1)
    expect(w.total[0].oee!).toBeCloseTo(0.6233499571596407, 10)
    const avg = parsed.shifts.filter((s) => s.costCenter === '51010171').reduce((a, s) => a + s.oee, 0) / 30
    expect(Math.abs(avg / 100 - w.total[0].oee!)).toBeGreaterThan(0.001)
  })

  it('daily % of loading for Progressive on 21 Sep = BoardReport row 46', () => {
    const b = lossForPeriod(days, parsed.downtimes.map(lossDayOf), progressive, plant, '2026-09-21', '2026-09-21')
    expect(b.oee!).toBeCloseTo(0.6506578404424769, 10)
    expect(chartShare(b, 'Die')).toBeCloseTo(0.07397899179429981, 10)
    expect(chartShare(b, 'Setup')).toBeCloseTo(0.15476582503914701, 10)
    expect(chartShare(b, 'Machine')).toBeCloseTo(0.021303906612275648, 10)
    expect(chartShare(b, 'Short')).toBeCloseTo(0.027849649527214613, 10)
    expect(chartShare(b, 'Others')).toBeCloseTo(0.03757753748345089, 10)
    expect(chartShare(b, 'Speed')).toBeCloseTo(0.06763327710535716, 10)
  })

  it('die OEE is weighted by good quantity (BoardReport AH78, PRS-110 week 39)', () => {
    const wk = mondayOfWeek(2026, 39)
    const dies = dieTable(parsed.orders, { area: 'PRS', key: 'all' }, plant, wk, '2026-09-27', costCentersOf(days))
    const worst = dies.filter((d) => d.workCenter === 'PRS-110').sort((a, b) => a.weightedOee! - b.weightedOee!)[0]
    expect(worst.equipment).toBe('M250SP015RO')
    expect(worst.weightedOee!).toBeCloseTo(0.5492753430543721, 10)
  })

  it('the week shift chart uses the shift numbers of the settings', () => {
    const t = weekShiftTrend(parsed.shifts, transfer, plant, mondayOfWeek(2026, 39))
    expect(t.slots.length).toBe(21)
    expect(t.slots[0].label).toBe('Mon-1')
    expect(t.unknown).toEqual([])
    const none = weekShiftTrend(parsed.shifts, transfer, { ...plant, shifts: [] }, mondayOfWeek(2026, 39))
    expect(none.unknown.sort()).toEqual(['UB64', 'UB65', 'UB66'])
  })

  it('without settings nothing is grouped by a value written in the program', () => {
    expect(configProblems(EMPTY_CONFIG).length).toBeGreaterThan(0)
    // Ayarsız: masraf yeri "Unassigned" alanına düşer, veri kaybolmaz.
    expect(inScope(days[0], { area: 'Unassigned', key: 'all' }, EMPTY_CONFIG)).toBe(true)
    const b = lossForPeriod(days, parsed.downtimes.map(lossDayOf), { area: 'Unassigned', key: 'all' }, EMPTY_CONFIG, '2026-09-21', '2026-09-21')
    expect(Object.keys(b.groups)).toEqual([])
  })

  it('suggests the settings from the codes in the data', () => {
    const s = suggestConfig({ days, shifts: parsed.shifts, downtimes: parsed.downtimes }, EMPTY_CONFIG, OEE_SUGGESTED)
    expect(s.areas).toEqual([{ name: 'PRS', pick: 'costCenter' }])
    expect(s.shifts).toEqual([
      { code: 'UB64', number: 1 },
      { code: 'UB65', number: 2 },
      { code: 'UB66', number: 3 },
    ])
    expect(s.lossReasonCodes).toEqual(['#', 'UNSCD_DOWN'])
    expect(s.breakReasonCodes).toEqual(['SCHED_DOWN'])
    expect(s.startupRunMin).toBe(60)
    // Kullanıcının verdiği ad öneride korunur.
    const kept = suggestConfig({ days, shifts: parsed.shifts, downtimes: parsed.downtimes }, plant, OEE_SUGGESTED)
    expect(kept.costCenters.find((c) => c.code === '51010171')!.name).toBe('Transfer')
  })

  it('suggests cost centers from shifts and downtimes when no day totals are stored', () => {
    const s = suggestConfig({ days: [], shifts: parsed.shifts, downtimes: parsed.downtimes }, EMPTY_CONFIG, OEE_SUGGESTED)
    expect(s.costCenters.map((c) => c.code).sort()).toEqual(['51010171', '51010173'])
    expect(s.areas).toEqual([{ name: 'PRS', pick: 'costCenter' }])
    expect(configProblems(s).some((p) => /area|cost center/i.test(p))).toBe(false)
  })

  it('a cost center code typed as an area is replaced by the area of its machines', () => {
    const wrong: OeeConfig = { ...EMPTY_CONFIG, areas: [{ name: '51010171', pick: 'costCenter' }, { name: '51010173', pick: 'costCenter' }] }
    expect(configProblems(wrong).some((p) => /no cost center/.test(p))).toBe(true)
    const s = suggestConfig({ days: [], shifts: parsed.shifts, downtimes: [] }, wrong, OEE_SUGGESTED)
    expect(s.areas.map((a) => a.name)).toEqual(['PRS'])
    expect(s.costCenters.every((c) => c.area === 'PRS')).toBe(true)
    // Adı verilmiş, alanı boş masraf yeri: ad kalır, alan önerilir.
    const named = suggestConfig({ days: [], shifts: parsed.shifts, downtimes: [] }, { ...EMPTY_CONFIG, costCenters: [{ code: '51010171', name: 'Transfer', area: '' }] }, OEE_SUGGESTED)
    expect(named.costCenters.find((c) => c.code === '51010171')).toEqual({ code: '51010171', name: 'Transfer', area: 'PRS' })
    expect(configProblems({ ...plant, costCenters: [{ code: 'X', name: 'X', area: 'Nope' }] })).toContain('Cost center X has no department (Company settings → Organization).')
  })

  it('a week is the sum of its days, or the uploaded week when that covers more loading', () => {
    const wc = 'PRS-106'
    const fromDays = sumTimes(days.filter((d) => d.workCenter === wc))
    const partial: WeeklyRow = { ...parsed.shifts[0], year: 2026, week: 39, workCenter: wc, scheduledSec: 0, ...fromDays, loadingMin: fromDays.loadingMin - 100 }
    const full: WeeklyRow = { ...partial, loadingMin: fromDays.loadingMin + 100 }
    expect(weekTimes(days, [partial]).get(`2026-W39|${wc}`)!.source).toBe('days')
    expect(weekTimes(days, [full]).get(`2026-W39|${wc}`)!.source).toBe('upload')
  })

  it('setup is OK when the set production time follows it before the next setup', () => {
    const ev = (start: string, end: string, rc1: string, rc2: string, text: string, order = '1') => ({
      order, material: 'M1', mold: '', shiftGroup: 'UB', shiftDefinition: 'UB64', rc1, rc2, rc3: '', rc4: '', rc5: '',
      textEn: text, textTr: '', seconds: 0,
      minutes: (Date.parse(`2026-09-21T${end}Z`) - Date.parse(`2026-09-21T${start}Z`)) / 60000,
      startDate: '2026-09-21', startTime: start, endDate: '2026-09-21', endTime: end,
    })
    const day = {
      date: '2026-09-21', plant: '', plantKey: '', costCenter: '51010173', workCenter: 'PRS-104',
      events: [
        ev('08:00:00', '08:30:00', 'UNSCD_DOWN', 'STP', 'DIE SETUP - PLANNED'),
        ev('08:40:00', '08:50:00', 'UNSCD_DOWN', 'KSD', 'SHORT DOWNTIMES'),
        ev('09:00:00', '09:05:00', 'SCHED_DOWN', 'UTS', 'TEA BREAK (5 MIN)'),
        ev('10:00:00', '10:30:00', 'UNSCD_DOWN', 'STP', 'DIE SETUP - UNPLANNED', '2'),
        ev('10:30:00', '10:40:00', 'UNSCD_DOWN', 'STP', 'SENSOR ADJUSTMENT', '2'),
        ev('10:45:00', '11:30:00', 'UNSCD_DOWN', 'KLP', 'BURR', '2'),
        ev('11:35:00', '12:00:00', 'UNSCD_DOWN', 'STP', 'DIE SETUP - PLANNED', '3'),
        ev('12:00:00', '14:00:00', 'UNSCD_DOWN', 'ARZ', 'PRESS', '3'),
      ],
    }
    const rows = setupAnalysis([day], [], { area: 'PRS', key: 'all' }, plant, '2026-09-21', '2026-09-21')
    expect(rows.map((r) => r.status)).toEqual(['ok', 'nok', 'open'])
    expect(rows[0].timeToRunMin).toBe(75)
    expect(rows[0].lost).toEqual({ KSD: 10, BREAK: 5 })
    expect(rows[1].setupMin).toBe(30)
    expect(rows[1].runMin).toBe(10)
    expect(rows[1].mainReason).toBe('KLP')
    // Alanın kendi süresi (APR ayrı): 10 dk yeterse ikinci setup da OK.
    const own = { ...plant, areas: plant.areas.map((a) => (a.name === 'PRS' ? { ...a, startupRunMin: 10 } : a)) }
    expect(startupRunOf('PRS', own)).toBe(10)
    expect(startupRunOf('APR', own)).toBe(60)
    expect(setupAnalysis([day], [], { area: 'PRS', key: 'all' }, own, '2026-09-21', '2026-09-21').map((r) => r.status)).toEqual(['ok', 'ok', 'open'])
    // Setup metni ayarda yoksa setup analizi yapılmaz.
    expect(setupAnalysis([day], [], { area: 'PRS', key: 'all' }, { ...plant, setupTexts: [] }, '2026-09-21', '2026-09-21')).toEqual([])
  })

  it('All: every cost center of the plant together, also those without an area', () => {
    const noArea = { ...plant, costCenters: plant.costCenters.map((x) => (x.code === '51010173' ? { ...x, area: '' } : x)) }
    expect(areaNames(days, noArea)[0]).toBe(PLANT_AREA)
    const all = totalsFor(days, { area: PLANT_AREA, key: 'all' }, noArea, '2026-01-01', '2026-12-31')
    expect(all.loadingMin).toBeCloseTo(sumTimes(days).loadingMin)
    const one = totalsFor(days, { area: PLANT_AREA, key: '51010173' }, noArea, '2026-01-01', '2026-12-31')
    expect(one.loadingMin).toBeCloseTo(sumTimes(days.filter((d) => d.costCenter === '51010173')).loadingMin)
  })

  it('upload keeps only the rows of the plant cost centers', () => {
    const { parsed: mine, skipped } = forPlantCostCenters(parsed, ['51010171'])
    expect(mine.shifts.every((r) => r.costCenter === '51010171')).toBe(true)
    expect(mine.shifts.length).toBeGreaterThan(0)
    expect(skipped.some((x) => x.costCenter === '51010173')).toBe(true)
    expect(mine.downtimes.every((d) => d.costCenter === '51010171')).toBe(true)
  })

  it('OEE area = department of the plant (K3); names from the plant; old area settings are inherited', () => {
    const old = { ...plant, areas: plant.areas.map((a) => (a.name === 'APR' ? { ...a, startupRunMin: 10 } : a)) }
    const merged = withPlantCostCenters(
      old,
      [
        { code: '51010171', name: 'Transfer line', department: 'Stamping' },
        { code: '51010173', name: 'Progressive', department: 'Stamping' },
        { code: '51010172', name: 'APR', department: 'Nut welding' },
        { code: '999', name: 'New' },
      ],
      ['Stamping', 'Nut welding', 'Assembly'],
    )
    expect(merged.costCenters.find((x) => x.code === '51010171')).toEqual({ code: '51010171', name: 'Transfer line', area: 'Stamping' })
    // Bölümü olmayan masraf yeri Unassigned'a düşer.
    expect(merged.costCenters.find((x) => x.code === '999')).toEqual({ code: '999', name: 'New', area: '' })
    // Alanlar = bölümler, sırasıyla; eski alanın ayarı (PRS: costCenter, APR: machine + 10 dk) devralınır.
    expect(merged.areas).toEqual([
      { name: 'Stamping', pick: 'costCenter' },
      { name: 'Nut welding', pick: 'machine', startupRunMin: 10 },
      { name: 'Assembly', pick: 'machine' },
    ])
    // Bölümün kendi kayıtlı ayarı devralınanın önüne geçer.
    const own = withPlantCostCenters({ ...plant, areas: [...plant.areas, { name: 'Nut welding', pick: 'costCenter' }] }, [{ code: '51010172', name: 'APR', department: 'Nut welding' }], ['Nut welding'])
    expect(own.areas).toEqual([{ name: 'Nut welding', pick: 'costCenter' }])
    expect(withPlantCostCenters(plant, [], []).costCenters).toEqual([])
  })

  it('data notes: empty periods, missing machines and the KPI–Downtimes difference', () => {
    const t = (loadingMin: number) => ({ ...sumTimes([]), loadingMin })
    const pt = (label: string, l: number) => ({ key: label, label, times: t(l), oee: null })
    const gaps = trendGaps({
      total: [pt('W31', 0), pt('W32', 100), pt('W33', 0), pt('W34', 200)],
      byWorkCenter: new Map([
        ['PRS-103', [pt('W31', 0), pt('W32', 100), pt('W33', 0), pt('W34', 100)]],
        ['PRS-104', [pt('W31', 0), pt('W32', 0), pt('W33', 0), pt('W34', 100)]],
      ]),
    })
    expect(gaps).toEqual(['No data: W33', 'W32: no data for PRS-104'])

    const d0 = days.find((d) => d.costCenter === '51010173' && d.date === '2026-09-21')!
    const loss = lossDayOf({ date: d0.date, plant: '', plantKey: '', costCenter: d0.costCenter, workCenter: d0.workCenter, events: [] })
    loss.codes = { 'UNSCD_DOWN|KSD': [d0.unscheduledMin - 7, 3], 'SCHED_DOWN|UTS': [30, 1] }
    const cov = lossCoverage([d0], [loss], progressive, plant, '2026-09-21', '2026-09-21')
    expect(cov.unscheduledKpi - cov.unscheduledDowntimes).toBeCloseTo(7)
    expect(cov.byWorkCenter[0].workCenter).toBe(d0.workCenter)
    expect(lossCoverage([d0], [], progressive, plant, '2026-09-21', '2026-09-21').noDowntimes).toEqual(['2026-09-21'])
  })

  it('weekly year from the latest date; monthly year from its Year column', () => {
    const shiftly = (fixture as unknown as Record<string, SheetRows>)['Shiftly KPI']
    const monthHead = ['Year', 'Month', 'Month Key', 'Plant - Key', 'Production Responsible', 'Cost Center - Key', 'Work Center', 'Scheduled Downtime', 'Loading Time(Min)']
    const p = parseOeeWorkbook({
      'Shiftly KPI': shiftly,
      'Monthly KPI': [monthHead, [2026, 'Ocak', '01', '5101', '601', '51010171', 'PRS-106', 0, 100], [2025, 'Aralık', '12', '5101', '601', '51010171', 'PRS-106', 0, 100]],
      'Weekly KPI': [
        ['Week', 'Plant - Key', 'Production Responsible', 'Cost Center - Key', 'Work Center', 'Loading Time(Min)'],
        [2, '5101', '601', '51010171', 'PRS-106', 100],
        [52, '5101', '601', '51010171', 'PRS-106', 100],
      ],
    })
    expect(p.monthly.map((m) => `${m.year}-${m.monthKey}`)).toEqual(['2026-01', '2025-12'])
    expect(p.weekly.map((w) => `${w.year}-${w.week}`)).toEqual(['2026-2', '2025-52'])
    // Year sütunu yoksa ya da boşsa dosya kabul edilmez.
    const noYear = parseOeeWorkbook({ 'Monthly KPI': [monthHead.slice(1), ['Ocak', '01', '5101', '601', '51010171', 'PRS-106', 0, 100]] })
    expect(noYear.problems.join()).toMatch(/Year/)
    const blank = parseOeeWorkbook({ 'Monthly KPI': [monthHead, ['', 'Ocak', '01', '5101', '601', '51010171', 'PRS-106', 0, 100]] })
    expect(blank.problems.join()).toMatch(/no valid Year in rows 2/)
  })

  it('dated sheets must start on a Monday (or on 1 January)', () => {
    expect(mondayStartProblem('Shiftly KPI', ['2026-09-14', '2026-09-28'])).toBeNull()
    expect(mondayStartProblem('Shiftly KPI', ['2026-01-01', '2026-01-05'])).toBeNull()
    expect(mondayStartProblem('Downtimes(1)', ['2026-09-02', '2026-09-01'])).toBe(
      'Downtimes(1) starts on Tuesday 01.09.2026 — export from a Monday (31.08.2026). The file was not uploaded.',
    )
    // Pazartesi'den başlamayan sayfa dosyanın tamamını durdurur.
    const shiftly = (fixture as unknown as Record<string, SheetRows>)['Shiftly KPI']
    const [head, ...body] = shiftly
    const dateCol = head.indexOf('Date')
    const late = [head, ...body.filter((r) => String(r[dateCol]) > '2026-09-21')]
    expect(parseOeeWorkbook({ 'Shiftly KPI': late }).problems.join()).toMatch(/starts on Tuesday/)
  })

  it('a group hidden in charts stays in the tables', () => {
    const c: OeeConfig = {
      ...plant,
      lossGroups: [
        { code: 'KLP', label: 'Die', chart: 'Die', breakdown: true },
        { code: '#', label: 'Unexplained', chart: '#', breakdown: false, hidden: true },
        { code: 'A', label: 'A', chart: 'Others', breakdown: false, hidden: true },
        { code: 'B', label: 'B', chart: 'Others', breakdown: false },
      ],
    }
    const columns = chartGroups(c)
    expect(columns).toEqual(['Die', '#', 'Others', 'Speed'])
    // Sütunun bütün grupları gizliyse grafikten çıkar; biri görünüyorsa kalır.
    expect(visibleChartGroups(columns, c)).toEqual(['Die', 'Others', 'Speed'])
    const s = suggestConfig({ days, shifts: parsed.shifts, downtimes: parsed.downtimes }, EMPTY_CONFIG, OEE_SUGGESTED)
    expect(s.lossGroups.filter((g) => g.hidden).map((g) => g.code)).toEqual(s.lossGroups.some((g) => g.code === '#') ? ['#'] : [])
  })

  it('ISO weeks', () => {
    expect(isoWeek('2026-09-21')).toEqual({ year: 2026, week: 39 })
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 })
    expect(mondayOfWeek(2026, 39)).toBe('2026-09-21')
  })
})

describe('oee store and upload — history is never deleted', () => {
  it('round-trips downtime and loss days', async () => {
    const { toStoredDay, fromStoredDay, toStoredLoss, fromStoredLoss } = await import('./oeeStore')
    const day = parsed.downtimes[0]
    expect(fromStoredDay(toStoredDay(day))).toEqual(day)
    const loss = lossDayOf(day)
    expect(fromStoredLoss(toStoredLoss(loss))).toEqual(loss)
    // İlk biçimdeki kayıt okunmaz (yeniden yüklenince yeni biçimle yazılır).
    expect(fromStoredLoss({ date: day.date, costCenter: '', workCenter: '' })).toBeNull()
  })

  it('the same downtime uploaded twice is stored once; a changed reason updates it', async () => {
    const { mergeEvents } = await import('./oeeStore')
    const events = parsed.downtimes[0].events
    const twice = mergeEvents(events, events)
    expect(twice.length).toBe(events.length)
    const recoded = { ...events[0], rc2: 'KLP', textEn: 'BURR' }
    const merged = mergeEvents(events, [recoded])
    expect(merged.length).toBe(events.length)
    expect(merged.find((e) => e.startTime === recoded.startTime && e.order === recoded.order)!.rc2).toBe('KLP')
    // Dosyada olmayan eski duruş silinmez.
    expect(mergeEvents(events, []).length).toBe(events.length)
  })

  it('upload only adds or updates — the API has no delete', async () => {
    const { importOee } = await import('./oeeStore')
    const calls: string[] = []
    const rec = (k: string) => async (a: { rows?: unknown[]; days?: unknown[] }) => {
      calls.push(`${k}:${(a.rows ?? a.days ?? []).length}`)
      return 0
    }
    const api = {
      upsertShifts: rec('shifts'),
      upsertDaily: rec('daily'),
      upsertOrders: rec('orders'),
      upsertWeekly: rec('weekly'),
      upsertMonthly: rec('monthly'),
      upsertDowntimeDays: rec('downtimes'),
      finishImport: async () => null,
    }
    await importOee(parsed, 'test.xlsx', api)
    expect(Object.keys(api).some((k) => /clear|delete|remove/i.test(k))).toBe(false)
    expect(calls.filter((c) => c.startsWith('shifts')).reduce((a, c) => a + Number(c.split(':')[1]), 0)).toBe(parsed.shifts.length)
    expect(calls.some((c) => c.startsWith('downtimes'))).toBe(true)
  })
})

describe('dosya biçimi 2026-10-06 (Report.xlsx + Downtimes.xlsx)', () => {
  // Gerçek dosyalardan kesit: 21.09.2026, APR-627 (1st/2nd/3rd = UB61–63) ve PRS-110 (UB64–66).
  const v2 = parseOeeWorkbook(fixtureV2 as unknown as Record<string, SheetRows>)

  it('iki dosyanın sayfaları eksik sütun olmadan okunur', () => {
    expect(v2.problems).toEqual([])
    expect(v2.read.map((r) => r.kind).sort()).toEqual(['downtimes', 'orders', 'shiftly'])
  })

  it('Shiftly KPI: vardiya kodu "Shift Defination", adı "Shift Definition Txt"', () => {
    const s = v2.shifts.find((x) => x.workCenter === 'APR-627' && x.shiftGroup === 'UB61')!
    expect(s).toMatchObject({ date: '2026-09-21', costCenter: '51010172', shiftDefinition: '1st Shift', good: 1580 })
    // Anahtar (tarih + makine + vardiya kodu) tekrarsız: vardiyalar birbirinin üstüne yazılmaz.
    expect(new Set(v2.shifts.map((x) => `${x.date}|${x.workCenter}|${x.shiftGroup}`)).size).toBe(v2.shifts.length)
    // Gün = vardiyaların toplamı.
    const day = daysFromShifts(v2.shifts).find((d) => d.workCenter === 'APR-627')!
    expect(day.loadingMin).toBeCloseTo(
      v2.shifts.filter((x) => x.workCenter === 'APR-627').reduce((a, x) => a + x.loadingMin, 0),
      9,
    )
  })

  it('Order Based: Plant - Key anahtar, Plant ad, Var_Equipment kalıp (boşsa boş), Material - Key malzeme, (Order) oranları', () => {
    const prs = v2.orders.find((o) => o.workCenter === 'PRS-110')!
    expect(prs).toMatchObject({ plant: '5101', plantName: 'Romanya Martur', equipment: 'PROGRESSIVE-DIE-6' })
    expect(prs.material).toMatch(/^M/)
    expect(prs.oee).toBeGreaterThan(0)
    const apr = v2.orders.find((o) => o.workCenter === 'APR-627')!
    expect(apr.equipment).toBe('')
    expect(apr.shift).toMatch(/^UB6[123]$/)
  })

  it('Downtimes: başlık 2. satırda, A sütunu boş', () => {
    const d = v2.downtimes.find((x) => x.workCenter === 'PRS-110')!
    expect(d).toMatchObject({ date: '2026-09-21', plantKey: '5101', costCenter: '51010173' })
    expect(d.events[0]).toMatchObject({ shiftGroup: 'UB', shiftDefinition: 'UB66', rc1: 'UNSCD_DOWN', rc2: 'KSD', minutes: 1 })
    expect(d.events.length).toBe(fixtureV2['Downtimes (1)'].length - 2)
  })
})

