import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import { chartGroups, daysFromShifts, lossDayOf, oeeOf, parseOeeWorkbook, sumTimes, type OeeConfig, type SheetRows } from './oee'
import { ASAKAI_WEEKS, asakaiDetail, asakaiWeekly } from './oeeAsakai'

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
