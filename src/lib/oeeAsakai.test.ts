import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import { UNASSIGNED, chartGroups, daysFromShifts, lossDayOf, oeeOf, parseOeeWorkbook, sumTimes, type LossDay, type OeeConfig, type SheetRows } from './oee'
import { ASAKAI_WEEKS, asakaiColumns, asakaiTopStops, asakaiDetail, asakaiWeekly, dropEmptyUnassigned } from './oeeAsakai'

// Gerçek kesit (ASAKAI dosyası): Progressive ve Transfer, 21 Eylül haftası.
const parsed = parseOeeWorkbook(fixture as unknown as Record<string, SheetRows>)
const plant: OeeConfig = {
  areas: [{ name: 'PRS', pick: 'costCenter' }],
  costCenters: [
    { code: '51010171', name: 'Transfer', area: 'PRS' },
    { code: '51010173', name: 'Progressive', area: 'PRS' },
  ],
  shifts: [
    { code: '1', number: 1 },
    { code: '2', number: 2 },
    { code: '3', number: 3 },
  ],
  lossReasonCodes: ['UNSCD_DOWN', '#'],
  breakReasonCodes: ['SCHED_DOWN'],
  lossGroups: [
    { code: 'KLP', label: 'Die breakdown', chart: 'Die', breakdown: true },
    { code: 'STP', label: 'Setup', chart: 'Setup', breakdown: false },
    {
      code: 'ARZ',
      label: 'Machine breakdown',
      chart: 'Machine',
      breakdown: true,
    },
  ],
  setupTexts: [],
  startupRunMin: 60,
  trendWeeks: 10,
  topN: 10,
}
const scope = { area: 'PRS', key: 'all' }
const day = '2026-09-21'
const days = daysFromShifts(parsed.shifts)
const lossDays = parsed.downtimes.map(lossDayOf)
const columns = chartGroups(plant, lossDays)

describe('Asakai weekly', () => {
  const groups = asakaiWeekly({ days, weekly: [], monthly: [], lossDays }, scope, plant, day, day, columns)

  it('masraf yeri başına bir grup; 12 ay, 10 hafta, 7 gün', () => {
    expect(groups.map((g) => g.name)).toEqual(['Progressive', 'Transfer'])
    for (const g of groups) {
      expect(g.monthly).toHaveLength(12)
      expect(g.monthly.slice(9).every((p) => p.oee === null)).toBe(true)
      expect(g.weekly).toHaveLength(ASAKAI_WEEKS)
      expect(g.stacked.map((s) => s.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    }
  })

  it('makine × gün OEE toplam süreden; grup satırı toplamın OEE’si', () => {
    const g = groups.find((x) => x.name === 'Progressive')!
    const rows = days.filter((d) => d.costCenter === '51010173' && d.date === day)
    expect(g.dailyTotal.days[0]).toBeCloseTo(oeeOf(sumTimes(rows))!, 9)
    for (const m of g.daily) {
      const mine = rows.filter((d) => d.workCenter === m.workCenter)
      if (mine.some((d) => d.loadingMin > 0)) expect(m.days[0]).toBeCloseTo(oeeOf(sumTimes(mine))!, 9)
    }
    expect(g.lossTotal.oee).toBeCloseTo(g.dailyTotal.week!, 9)
  })
})

describe('Asakai detail', () => {
  const shifts = parsed.shifts.filter((r) => r.date === day)
  const events = parsed.downtimes.filter((d) => d.date === day)
  const orders = parsed.orders.filter((o) => o.date === day)
  const groups = asakaiDetail({ shifts, events, orders }, scope, plant, columns)

  it('makinenin günü = vardiyalarının toplamı (Loading)', () => {
    const machines = groups.flatMap((g) => g.machines)
    expect(machines.length).toBeGreaterThan(0)
    for (const m of machines) {
      expect(m.shifts).toHaveLength(3)
      const sum = m.shifts.reduce((a, s) => a + s.loadingMin, 0)
      // Tanımsız vardiya kodu yoksa vardiyalar günü tam verir.
      expect(sum).toBeLessThanOrEqual(m.total.loadingMin + 1e-6)
      expect(m.partCells).toHaveLength(3)
    }
  })
})

describe('Asakai columns', () => {
  const c: OeeConfig = {
    ...plant,
    lossGroups: [
      ...plant.lossGroups,
      { code: 'UTS', label: 'Breaks', chart: 'UTS', breakdown: false },
      { code: '#', label: 'Undefined', chart: '#', breakdown: false, hidden: true },
    ],
  }

  it('ayardaki "#" grubu sütun değil, tanımsızlar en sonda Unassigned (UNASSIGNED); UTS sütunu yok', () => {
    const cols = asakaiColumns(c, [])
    expect(cols).not.toContain('#')
    expect(cols).not.toContain('UTS')
    expect(cols.at(-1)).toBe('Speed')
    const undef: LossDay = { date: '2026-10-19', costCenter: 'C', workCenter: 'W', codes: { 'UNSCD_DOWN|#': [10, 1], '#|KLP': [5, 1] }, reasons: {} }
    const withUndef = asakaiColumns(c, [undef])
    expect(withUndef.slice(-2)).toEqual(['Speed', UNASSIGNED])
  })

  it('UTS başka gruplarla aynı sütundaysa sütun kalır', () => {
    const shared = { ...c, lossGroups: c.lossGroups.map((g) => (g.code === 'UTS' ? { ...g, chart: 'Setup' } : g)) }
    expect(asakaiColumns(shared, [])).toContain('Setup')
  })

  it('Unassigned yalnız süresi varsa', () => {
    const row = (v: number) => ({ label: 'x', loadingMin: 100, oee: 0.5, shares: { Unassigned: v } })
    expect(dropEmptyUnassigned(['Setup', 'Unassigned'], [row(0)])).toEqual(['Setup'])
    expect(dropEmptyUnassigned(['Setup', 'Unassigned'], [row(0.02)])).toEqual(['Setup', 'Unassigned'])
  })
})

describe('Asakai red cells', () => {
  it('iş yerinin en büyük 2 duruşu; Speed ve Unassigned sayılmaz', () => {
    const row = { label: 'W', loadingMin: 480, oee: 0.6, shares: { STP: 0.05, KLP: 0.12, ARZ: 0.02, Speed: 0.3, Unassigned: 0.2, KON: 0 } }
    const cols = ['STP', 'KLP', 'ARZ', 'KON', 'Speed', 'Unassigned']
    expect([...asakaiTopStops(row, cols)].sort()).toEqual(['KLP', 'STP'])
    // Tek duruş varsa yalnız o; Loading yoksa hiçbiri.
    expect([...asakaiTopStops({ ...row, shares: { ARZ: 0.01 } }, cols)]).toEqual(['ARZ'])
    expect(asakaiTopStops({ ...row, loadingMin: 0 }, cols).size).toBe(0)
  })
})

describe('Asakai short stops', () => {
  it('kısa duruş sütun değil; süresi SPEED_LOSS içinde', () => {
    const lossDays = [{ date: day, costCenter: '51010173', workCenter: 'W', codes: { 'UNSCD_DOWN|STP<': [10, 6] as [number, number], 'UNSCD_DOWN|STP': [30, 1] as [number, number] }, reasons: {} }]
    expect(asakaiColumns(plant, lossDays)).not.toContain('Short stops')
    const d = { ...days[0], date: day, costCenter: '51010173', workCenter: 'W', loadingMin: 400, productionMin: 300, operatingMin: 270 }
    const [g] = asakaiWeekly({ days: [d], weekly: [], monthly: [], lossDays }, scope, plant, day, day, asakaiColumns(plant, lossDays))
    // Production − Operation = 30 dk = 20 hız + 10 kısa → 30 / 400.
    expect(g.lossTotal.shares.Speed).toBeCloseTo(30 / 400, 9)
    expect(g.lossTotal.shares.Setup).toBeCloseTo(30 / 400, 9)
  })
})
