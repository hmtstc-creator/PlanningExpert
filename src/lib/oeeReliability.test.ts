import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import { daysFromShifts, inScope, lossDayOf, parseOeeWorkbook, reliability, type OeeConfig, type SheetRows } from './oee'
import { ddmmyy } from './oeeFilters'
import {
  BIN_CAP,
  BUCKETS,
  binOf,
  bucketDetail,
  bucketRows,
  defaultSetupTexts,
  fromStoredStops,
  partStops,
  reasonShiftParts,
  relCategories,
  relGrid,
  stopDayOf,
} from './oeeReliability'

// Gerçek kesit (ASAKAI dosyası).
const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
const plant: OeeConfig = {
  areas: [{ name: 'PRS', pick: 'costCenter' }],
  costCenters: [
    { code: '51010171', name: 'Transfer', area: 'PRS' },
    { code: '51010173', name: 'Progressive', area: 'PRS' },
  ],
  shifts: [],
  lossReasonCodes: ['UNSCD_DOWN', '#'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [
    { code: 'KLP', label: 'KLP', chart: 'Die', breakdown: true },
    { code: 'STP', label: 'STP', chart: 'Setup', breakdown: false },
    { code: 'ARZ', label: 'ARZ', chart: 'Machine', breakdown: true },
    { code: 'KSD', label: 'KSD', chart: 'Short', breakdown: false },
  ],
  setupTexts: [
    { text: 'DIE SETUP - PLANNED', kind: 'planned' },
    { text: 'DIE SETUP - UNPLANNED', kind: 'unplanned' },
    { text: 'COIL SETUP', kind: 'planned' },
    { text: 'GRIPPER SETUP', kind: 'unplanned' },
  ],
  startupRunMin: 60,
  trendWeeks: 10,
  topN: 10,
}
const all = { area: 'PRS', key: 'all' }
const days = daysFromShifts(parsed.shifts).filter((d) => inScope(d, all, plant))
const stops = fromStoredStops(parsed.downtimes.map(stopDayOf))
const dates = days.map((d) => d.date).sort()
const from = dates[0]
const to = dates[dates.length - 1]
const period = [{ key: 'p', label: 'P', from, to }]
const cats = relCategories(plant, defaultSetupTexts(plant))
const cat = (k: string) => cats.find((c) => c.key === k)!

describe('süre histogramı', () => {
  it('dilim tam dakika, üst sınırda toplanır', () => {
    expect(binOf(1.99)).toBe(1)
    expect(binOf(2)).toBe(2)
    expect(binOf(9.7)).toBe(9)
    expect(binOf(999)).toBe(BIN_CAP)
  })

  it('histogram duruşların adedini ve dakikasını kaybetmez', () => {
    for (const d of parsed.downtimes) {
      const h = stopDayOf(d)
      const n = h.bins.reduce((a, b) => a + Number(b[4]), 0)
      const m = h.bins.reduce((a, b) => a + Number(b[5]), 0)
      expect(n).toBe(d.events.length)
      expect(m).toBeCloseTo(
        d.events.reduce((a, e) => a + e.minutes, 0),
        1,
      )
    }
  })
})

describe('MTTR / MTBF', () => {
  it('STP varsayılanı kalıp ve rulo setup metinleri', () => {
    expect(defaultSetupTexts(plant)).toEqual(['DIE SETUP - PLANNED', 'DIE SETUP - UNPLANNED', 'COIL SETUP'])
    expect(cats.map((c) => c.key)).toEqual(['KLP', 'ARZ', 'setup'])
  })

  it('eşik 0 iken eski MTTR / MTBF tablosuyla aynı', () => {
    const old = reliability(days, parsed.downtimes.map(lossDayOf), all, plant, from, to)
    for (const code of ['KLP', 'ARZ']) {
      const g = relGrid(stops, days, period, cat(code), { lo: 0, hi: Infinity }, all, plant)
      for (const r of old) {
        const row = g.rows.find((x) => x.workCenter === r.workCenter)!
        expect(row.cells[0].count, `${code} ${r.workCenter}`).toBe(r.groups[code].count)
        expect(row.cells[0].minutes).toBeCloseTo(r.groups[code].minutes, 1)
        if (r.groups[code].mtbfMin !== null) expect(row.cells[0].mtbf).toBeCloseTo(r.groups[code].mtbfMin!, 3)
      }
    }
  })

  it('en az N dakika: kısa duruşlar sayılmaz, MTTR büyür', () => {
    const c = cat('KLP')
    const a = relGrid(stops, days, period, c, { lo: 0, hi: Infinity }, all, plant).total[0]
    const b = relGrid(stops, days, period, c, { lo: 10, hi: Infinity }, all, plant).total[0]
    expect(b.count).toBeLessThanOrEqual(a.count)
    if (b.count && a.count) expect(b.mttr!).toBeGreaterThanOrEqual(a.mttr!)
  })

  it('süre kovaları toplamı tüm duruşlara eşit', () => {
    for (const c of cats) {
      const rows = bucketRows(stops, days, from, to, c, all, plant)
      const total = relGrid(stops, days, period, c, { lo: 0, hi: Infinity }, all, plant).total[0]
      expect(rows.map((r) => r.key)).toEqual(BUCKETS.map((b) => b.key))
      expect(rows.reduce((x, r) => x + r.cell.count, 0)).toBe(total.count)
      expect(rows.reduce((x, r) => x + r.cell.minutes, 0)).toBeCloseTo(total.minutes, 1)
      // Ham duruşlardan ayrıntı aynı adedi bulur.
      const detail = BUCKETS.map((b) => bucketDetail(parsed.downtimes, c, b.range, all, plant))
      rows.forEach((r, i) => expect(detail[i].presses.reduce((x, t) => x + t.count, 0)).toBe(r.cell.count))
    }
  })
})

describe('parça ve vardiya ayrıntısı', () => {
  it('parçanın duruşları kayıp özetindeki parça dakikasına eşit', () => {
    const d = parsed.downtimes.find((x) => x.events.some((e) => e.material && e.rc1 === 'UNSCD_DOWN'))!
    const material = d.events.find((e) => e.material && e.rc1 === 'UNSCD_DOWN')!.material
    const rows = partStops([d], d.workCenter, material, plant)
    const fromSummary = Object.entries(lossDayOf(d).parts!)
      .filter(([k]) => k.startsWith('UNSCD_DOWN|') && k.endsWith(`|${material}`) && !k.split('|')[1].includes('#'))
      .reduce((a, [, [m]]) => a + m, 0)
    expect(rows.reduce((a, r) => a + r.minutes, 0)).toBeCloseTo(fromSummary, 3)
  })

  it('neden × parça × vardiya toplamı nedenin dakikası', () => {
    const { shifts, parts } = reasonShiftParts(parsed.downtimes, ['KLP'], plant)
    for (const [text, rows] of parts) {
      const byShift = [...(shifts.get(text) ?? new Map()).values()].reduce((a, m) => a + m, 0)
      expect(rows.reduce((a, r) => a + r.minutes, 0)).toBeCloseTo(byShift, 3)
    }
  })
  it('her satırın günleri sıralı ve toplamı satırın süresi (Die Follow-up tarihi)', () => {
    const { parts } = reasonShiftParts(parsed.downtimes, ['KLP'], plant)
    const rows = [...parts.values()].flat()
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.days.length).toBeGreaterThan(0)
      expect(r.days.map((d) => d.date)).toEqual([...r.days.map((d) => d.date)].sort())
      expect(r.days.reduce((a, d) => a + d.minutes, 0)).toBeCloseTo(r.minutes, 3)
    }
  })
})

describe('çıktı adı', () => {
  it('GGAAYY', () => expect(ddmmyy('2026-10-14')).toBe('141026'))
})
