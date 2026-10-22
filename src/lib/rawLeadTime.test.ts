import { describe, expect, it } from 'vitest'

import { deadlineStatus, leadTimeLookup, orderDeadlines, weekEndIso } from './rawLeadTime'
import type { RawMrpResult } from './rawMrp'
import { SETTINGS_DEFAULTS } from './settingsDefaults'

const row = (orderKg: number) => ({ needKg: 0, stockStartKg: 0, inTransitKg: 0, safetyKg: 0, orderKg, stockEndKg: 0 })
const result = (orders: number[]): RawMrpResult => ({
  rawMaterial: 'S1',
  materials: ['P1'],
  stockKg: 0,
  totalInTransitKg: 0,
  totalNeedKg: 0,
  totalOrderKg: orders.reduce((a, b) => a + b, 0),
  coversWeeks: 0,
  rows: orders.map(row),
})
const weeks = [
  { start: '2026-10-19', label: '2026-W43' },
  { start: '2026-10-26', label: '2026-W44' },
  { start: '2026-11-02', label: '2026-W45' },
  { start: '2026-11-16', label: '2026-W47' },
]

describe('leadTimeLookup', () => {
  it('uses the row of the coil, else the default row, else the setting default', () => {
    expect(leadTimeLookup([]).of('S1')).toEqual({ days: SETTINGS_DEFAULTS.rawLeadTimeDays, entered: false })
    const lookup = leadTimeLookup([
      { rawMaterialCode: '*', leadTimeDays: 21 },
      { rawMaterialCode: 'S1 ', leadTimeDays: 7, supplier: 'Erdemir' },
    ])
    expect(lookup.of('S1')).toEqual({ days: 7, entered: true, supplier: 'Erdemir' })
    expect(lookup.of('S2')).toEqual({ days: 21, entered: false })
    expect(lookup.defaultEntered).toBe(true)
  })
})

describe('orderDeadlines', () => {
  it('order by = delivery week start − lead time in calendar days', () => {
    const d = orderDeadlines(result([0, 500, 0, 800]), weeks, { days: 14, entered: true }, '2026-10-22')
    expect(d.map((x) => [x.deliveryWeekStart, x.orderBy, x.status])).toEqual([
      ['2026-10-26', '2026-10-12', 'late'],
      ['2026-11-16', '2026-11-02', 'later'],
    ])
  })

  it('an order whose deadline falls in the current week is due this week', () => {
    const d = orderDeadlines(result([0, 0, 300]), weeks, { days: 10, entered: false }, '2026-10-22')
    expect(d[0]).toMatchObject({ orderBy: '2026-10-23', status: 'thisWeek', leadTimeEntered: false, orderKg: 300 })
  })

  it('zero lead time: this week\'s delivery is ordered today at the latest', () => {
    expect(deadlineStatus('2026-10-22', '2026-10-22')).toBe('thisWeek')
    expect(deadlineStatus('2026-10-21', '2026-10-22')).toBe('late')
  })
})

describe('weekEndIso', () => {
  it('returns the Sunday of the week', () => {
    expect(weekEndIso('2026-10-19')).toBe('2026-10-25')
    expect(weekEndIso('2026-10-22')).toBe('2026-10-25')
    expect(weekEndIso('2026-10-25')).toBe('2026-10-25')
  })
})
