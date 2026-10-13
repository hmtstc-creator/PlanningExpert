import { describe, expect, it } from 'vitest'

import fixture from './oee.fixture.json'
import { daysFromShifts, inScope, lossDayOf, parseOeeWorkbook, type OeeConfig, type SheetRows } from './oee'
import { buildBridge, level3, matchedLossDays } from './oeeBridge'
import { dailyReport } from './oeeDailyReport'

// Gerçek kesit (ASAKAI dosyası): Progressive 21 Eylül.
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
    { code: 'KLP', label: 'Die breakdown', chart: 'Die', breakdown: true },
    { code: 'STP', label: 'Setup', chart: 'Setup', breakdown: false },
    { code: 'ARZ', label: 'Machine breakdown', chart: 'Machine', breakdown: true },
    { code: 'KSD', label: 'Short stoppages', chart: 'Short', breakdown: false },
    { code: 'KON', label: 'Quality', chart: 'Others', breakdown: false },
    { code: 'OFC', label: 'Logistic', chart: 'Others', breakdown: false },
    { code: 'YNT', label: 'Management', chart: 'Others', breakdown: false },
    { code: 'UTS', label: 'Breaks', chart: 'Others', breakdown: false },
    { code: '#', label: 'Undefined', chart: 'Undefined', breakdown: false, hidden: true },
  ],
  setupTexts: [],
  startupRunMin: 60,
  trendWeeks: 10,
  topN: 10,
}
const progressive = { area: 'PRS', key: '51010173' }
const day = '2026-09-21'
const days = daysFromShifts(parsed.shifts).filter((d) => d.date === day && inScope(d, progressive, plant))
const lossDays = matchedLossDays(
  days,
  parsed.downtimes.map(lossDayOf).filter((l) => l.date === day && inScope(l, progressive, plant)),
)
const orders = parsed.orders.filter((o) => o.date === day && days.some((d) => d.workCenter === o.workCenter))
const set = { days, lossDays, orders }

describe('OEE Daily Report', () => {
  const { rows, total } = dailyReport(set, plant)

  it('her iş yeri bir satır; OEE köprüyle aynı', () => {
    const centers = [...new Set(days.filter((d) => d.loadingMin > 0).map((d) => d.workCenter))].sort()
    expect(rows.map((r) => r.workCenter)).toEqual(centers)
    for (const r of rows) {
      const b = buildBridge(
        days.filter((d) => d.workCenter === r.workCenter),
        lossDays.filter((l) => l.workCenter === r.workCenter),
        plant,
      )
      expect(r.oee).toBeCloseTo(b.oee!, 9)
    }
    expect(total.oee).toBeCloseTo(buildBridge(days, lossDays, plant).oee!, 9)
  })

  it('en büyük 3 kayıp: çoktan aza, hız kaybı ve açıklanmayan fark yok', () => {
    for (const r of rows) {
      expect(r.losses.length).toBeLessThanOrEqual(3)
      expect(r.losses.every((l) => l.key !== 'pf:speed' && l.key !== 'av:unexplained')).toBe(true)
      expect(r.losses.map((l) => l.minutes)).toEqual([...r.losses.map((l) => l.minutes)].sort((a, b) => b - a))
    }
    expect(rows.some((r) => r.losses.length === 3)).toBe(true)
  })

  it('malzemeler parça kırılımının ilk 3’ü; toplam satırında iş yeriyle', () => {
    const r = rows.find((x) => x.losses.length > 0)!
    const loss = r.losses[0]
    const item = buildBridge(
      days.filter((d) => d.workCenter === r.workCenter),
      lossDays.filter((l) => l.workCenter === r.workCenter),
      plant,
    ).items.find((i) => i.key === loss.key)!
    const only = <T extends { workCenter: string }>(xs: T[]) => xs.filter((x) => x.workCenter === r.workCenter)
    const parts = level3(
      item,
      'part',
      plant,
      { days: only(days), lossDays: only(lossDays), orders: only(orders) },
      set && { days: [], lossDays: [], orders: [] },
    )
    expect(loss.parts.map((p) => p.minutes)).toEqual(parts.slice(0, 3).map((p) => p.minutes))
    expect(loss.parts.every((p) => !p.sub)).toBe(true)
    expect(loss.parts.reduce((a, p) => a + p.minutes, 0)).toBeLessThanOrEqual(loss.minutes + 1e-6)
    expect(total.losses.flatMap((l) => l.parts).every((p) => p.sub)).toBe(true)
  })
})
