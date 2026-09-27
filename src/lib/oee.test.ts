import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import {
  chartShare,
  costCentersOf,
  dieTable,
  isoWeek,
  lossDayOf,
  lossForPeriod,
  mondayOfWeek,
  parseOeeWorkbook,
  ratios,
  setupAnalysis,
  sheetKind,
  sumTimes,
  weeklyTrend,
  weekShiftTrend,
  type SheetRows,
} from './oee'

// Veri: ASAKAI_2026_REV_12.xlsm'den kesit (Transfer 39. hafta vardiyaları,
// Progressive 21 Eylül vardiya ve duruşları, PRS-110 39. hafta siparişleri).
// Beklenen değerler Excel'in kendi hücrelerinden (BoardReport).
const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)

describe('oee workbook', () => {
  it('reads only the needed sheets; Daily KPI is calculated, not read', () => {
    expect(sheetKind('Daily KPI')).toBeNull()
    expect(sheetKind('Downtimes (1)')).toBe('downtimes')
    expect(sheetKind('Shiftly Base Order KPI')).toBe('orders')
    expect(parsed.read.map((r) => r.kind).sort()).toEqual(['downtimes', 'orders', 'shiftly'])
    expect(parsed.shifts.length).toBe(40)
  })

  it('shift ratios are sum-based and match the file', () => {
    for (const s of parsed.shifts) {
      const r = ratios(s)
      expect(r.availability! * 100).toBeCloseTo(s.availability, 6)
      expect(r.oee! * 100).toBeCloseTo(s.oee, 6)
    }
  })

  it('weekly OEE of Transfer = Weekly KPI / Losses_Follow B6 (sum of operating ÷ sum of loading)', () => {
    // BoardReport AQ30 aynı formül ama dosyada eski hesaplanmış değeri duruyor (0,6249).
    const w = weeklyTrend(parsed.shifts, [], { area: 'PRS', key: '51010171' }, mondayOfWeek(2026, 39), 1)
    expect(w.weeks[0].oee!).toBeCloseTo(0.6233499571596407, 10)
    // Yüzde ortalaması farklı sonuç verir — kullanılmaz.
    const avg = parsed.shifts.filter((s) => s.costCenter === '51010171').reduce((a, s) => a + s.oee, 0) / 30
    expect(Math.abs(avg / 100 - w.weeks[0].oee!)).toBeGreaterThan(0.001)
  })

  it('daily % of loading for Progressive on 21 Sep = BoardReport row 46', () => {
    const scope = { area: 'PRS' as const, key: '51010173' }
    const b = lossForPeriod(parsed.shifts, parsed.downtimes.map(lossDayOf), scope, '2026-09-21', '2026-09-21')
    expect(b.oee!).toBeCloseTo(0.6506578404424769, 10)
    expect(chartShare(b, 'die')).toBeCloseTo(0.07397899179429981, 10)
    expect(chartShare(b, 'setup')).toBeCloseTo(0.15476582503914701, 10)
    expect(chartShare(b, 'machine')).toBeCloseTo(0.021303906612275648, 10)
    expect(chartShare(b, 'short')).toBeCloseTo(0.027849649527214613, 10)
    expect(chartShare(b, 'others')).toBeCloseTo(0.03757753748345089, 10)
    expect(chartShare(b, 'speed')).toBeCloseTo(0.06763327710535716, 10)
  })

  it('die OEE is weighted by good quantity (BoardReport AH78, PRS-110 week 39)', () => {
    const wk = mondayOfWeek(2026, 39)
    const dies = dieTable(parsed.orders, { area: 'PRS', key: 'all' }, wk, '2026-09-27', costCentersOf(parsed.shifts))
    const worst = dies.filter((d) => d.workCenter === 'PRS-110').sort((a, b) => a.weightedOee! - b.weightedOee!)[0]
    expect(worst.equipment).toBe('M250SP015RO')
    expect(worst.weightedOee!).toBeCloseTo(0.5492753430543721, 10)
  })

  it('the week shift chart has 21 slots, Mon-1 … Sun-3', () => {
    const t = weekShiftTrend(parsed.shifts, { area: 'PRS', key: '51010171' }, mondayOfWeek(2026, 39))
    expect(t.slots.length).toBe(21)
    expect(t.slots[0].label).toBe('Mon-1')
    expect(t.slots[20].label).toBe('Sun-3')
    expect(sumTimes(t.slots.map((s) => s.times)).loadingMin).toBeCloseTo(
      sumTimes(parsed.shifts.filter((s) => s.costCenter === '51010171')).loadingMin,
      6,
    )
  })

  it('setup is OK when one hour of production follows it before the next die setup', () => {
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
    const rows = setupAnalysis([day], [], { area: 'PRS', key: 'all' }, '2026-09-21', '2026-09-21')
    expect(rows.map((r) => r.status)).toEqual(['ok', 'nok', 'open'])
    // 08:30 → 60 dk üretim: 10 dk KSD + 5 dk mola araya girer → 09:45.
    expect(rows[0].timeToRunMin).toBe(75)
    expect(rows[0].lost).toEqual({ KSD: 10, BREAK: 5 })
    // Sensör ayarı setup sayılmaz; kalıp arızası üretime geçirmedi.
    expect(rows[1].setupMin).toBe(30)
    expect(rows[1].runMin).toBe(10)
    expect(rows[1].mainReason).toBe('KLP')
    expect(rows[1].lost).toEqual({ STP: 10, KLP: 45 })
  })

  it('ISO weeks', () => {
    expect(isoWeek('2026-09-21')).toEqual({ year: 2026, week: 39 })
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 })
    expect(mondayOfWeek(2026, 39)).toBe('2026-09-21')
  })
})

describe('oee store and import', () => {
  it('round-trips downtime and loss days', async () => {
    const { toStoredDay, fromStoredDay, toStoredLoss, fromStoredLoss } = await import('./oeeStore')
    const day = parsed.downtimes[0]
    expect(fromStoredDay(toStoredDay(day))).toEqual(day)
    const loss = lossDayOf(day)
    expect(fromStoredLoss(toStoredLoss(loss))).toEqual(loss)
  })

  it('import replaces the file range per kind and records the upload', async () => {
    const { importOee, chunkBySize } = await import('./oeeStore')
    const calls: string[] = []
    const inserted: Record<string, number> = {}
    const add = (k: string) => async (a: { rows?: unknown[]; days?: unknown[] }) => {
      inserted[k] = (inserted[k] ?? 0) + (a.rows ?? a.days ?? []).length
      return 0
    }
    await importOee(parsed, 'test.xlsx', {
      clearRange: async (a) => {
        calls.push(`${a.kind}:${a.from ?? ''}:${a.to ?? ''}`)
        return { deleted: 0, more: false }
      },
      insertShifts: add('shifts'),
      insertOrders: add('orders'),
      insertWeekly: add('weekly'),
      insertMonthly: add('monthly'),
      insertDowntimeDays: add('downtimes'),
      insertLossDays: add('losses'),
      finishImport: async () => null,
    })
    expect(calls.some((c) => c.startsWith('shifts:2026-09-21:2026-09-2'))).toBe(true)
    expect(calls).toContain('downtimes:2026-09-21:2026-09-21')
    expect(inserted.shifts).toBe(parsed.shifts.length)
    expect(inserted.orders).toBe(parsed.orders.length)
    expect(inserted.downtimes).toBe(parsed.downtimes.length)
    expect(inserted.losses).toBe(parsed.downtimes.length)
    expect(inserted.monthly).toBeUndefined()
    expect(chunkBySize([1, 2, 3], 1_000_000, 2)).toEqual([[1, 2], [3]])
  })
})

describe('weekly archive (Weekly KPI_fix)', () => {
  it('is kept in the program and wins over a partial uploaded week', async () => {
    const { WEEKLY_ARCHIVE, WEEKLY_ARCHIVE_YEAR } = await import('./oeeWeeklyArchive')
    const { archiveRows, mergeWeekly } = await import('./oee')
    const archive = archiveRows(WEEKLY_ARCHIVE, WEEKLY_ARCHIVE_YEAR)
    expect(archive.length).toBe(629)
    // Weekly KPI_fix, 36. hafta PRS-106 Loading 6481,85 dk; Weekly KPI'da (yarım hafta) 5127,68.
    const partial = { ...archive.find((r) => r.week === 36 && r.workCenter === 'PRS-106')!, loadingMin: 5127.68, source: 'weekly' as const }
    const later = { ...partial, week: 38, source: 'weekly' as const }
    const merged = mergeWeekly(archive, [partial, later])
    expect(merged.find((r) => r.week === 36 && r.workCenter === 'PRS-106')!.loadingMin).toBeCloseTo(6481.85, 2)
    expect(merged.find((r) => r.week === 38 && r.workCenter === 'PRS-106')!.loadingMin).toBeCloseTo(5127.68, 2)
    // Yüklenen yeni bir Weekly KPI_fix arşivi düzeltir.
    const fix = { ...partial, loadingMin: 7000, source: 'archive' as const }
    expect(mergeWeekly(archive, [fix]).find((r) => r.week === 36 && r.workCenter === 'PRS-106')!.loadingMin).toBe(7000)
    // Arşivli hafta dashboard'da görünür (Transfer 30. hafta).
    const w = weeklyTrend([], merged, { area: 'PRS', key: '51010171' }, mondayOfWeek(2026, 30), 1)
    expect(w.weeks[0].oee).not.toBeNull()
  })
})
