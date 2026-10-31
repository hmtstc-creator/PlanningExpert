import { describe, expect, it } from 'vitest'

import { capacityModel } from './capacityModel'
import {
  OPERATOR_SHIFTS_PER_DAY,
  OPERATOR_WEEKLY_EXAMPLE,
  mergeWeeklyHeadcount,
  operatorPattern,
  operatorWeekCapacity,
  operatorWeekHours,
  shiftHeadcountFromWeekly,
} from './operatorCapacity'

describe('operator plan: weekly capacity', () => {
  it('the Planning Logic example: min(4 × 3 × 5, 12 ÷ 1.5 × 5) = 40 shifts, 4 operators per shift', () => {
    const cap = operatorWeekCapacity(OPERATOR_WEEKLY_EXAMPLE)
    expect(OPERATOR_SHIFTS_PER_DAY).toBe(3)
    expect(cap).toMatchObject({ machineShifts: 60, operatorShifts: 40, shifts: 40 })
    expect(cap.factor).toBeCloseTo(2 / 3)
    expect(shiftHeadcountFromWeekly(OPERATOR_WEEKLY_EXAMPLE.weeklyOperators)).toBe(4)
  })

  it('without a weekly count the machines decide; more people than machines do not add capacity', () => {
    expect(operatorWeekCapacity({ crewSizes: [1, 2], workingDays: 5 })).toEqual({
      machineShifts: 30,
      operatorShifts: null,
      shifts: 30,
      factor: 1,
    })
    expect(operatorWeekCapacity({ crewSizes: [1, 1], workingDays: 4, weeklyOperators: 50 })).toMatchObject({ shifts: 24, factor: 1 })
  })
})

describe('operator plan: weekly count → per-shift headcount', () => {
  const working = (iso: string) => !['2026-11-07', '2026-11-08'].includes(iso)

  it('fills shifts 1..3 with floor(weekly ÷ 3) on working days without a per-shift entry', () => {
    const merged = mergeWeeklyHeadcount(
      [{ costCenter: 'W', date: '2026-11-03', shift: 2, operators: 9 }],
      [{ costCenter: 'W', weekStart: '2026-11-02', operators: 10 }],
      working,
    )
    // Izgara girilen gün (3 Kasım) aynen kalır; 5 iş gününden 4'ü haftalıktan.
    expect(merged.filter((h) => h.date === '2026-11-03')).toEqual([{ costCenter: 'W', date: '2026-11-03', shift: 2, operators: 9 }])
    expect(merged.filter((h) => h.date === '2026-11-02').map((h) => [h.shift, h.operators])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(merged.filter((h) => h.date >= '2026-11-07')).toEqual([])
    expect(merged).toHaveLength(1 + 4 * 3)
  })
})

describe('operator plan: 3 shifts a day in the capacity model', () => {
  it('ignores the template and exception week of an operator line', () => {
    const pattern = operatorPattern(
      [
        { name: 'L1', costCenter: 'W' },
        { name: 'P1', costCenter: 'S' },
      ],
      ['W'],
      ['MO', 'TU', 'WE', 'TH'],
    )
    expect(pattern).toEqual({ presses: ['L1'], workingDays: 4 })
    const model = capacityModel({
      shiftMinutes: 480,
      shiftStartMinute: 420,
      plannedStops: [],
      templates: [
        { press: 'L1', workingDays: 5, shiftsPerDay: 1 },
        { press: 'P1', workingDays: 5, shiftsPerDay: 1 },
      ],
      weekOverrides: [{ press: 'L1', weekStart: '2026-11-02', workingDays: 1, shiftsPerDay: 1 }],
      holidays: new Set(),
      operatorPattern: pattern,
    })
    const monday = new Date('2026-11-02T00:00:00')
    const shifts = (press: string) => model.weekBuckets(press, monday).reduce((s, b) => s + b.shifts, 0)
    expect(shifts('L1')).toBe(4 * 3)
    expect(shifts('P1')).toBe(5)
  })
})

describe('operator plan: weekly capacity in hours', () => {
  it('1 line, 3 shifts, 5 working days, 7,5 h shifts → 112,5 h machine limit', () => {
    const h = operatorWeekHours({ crewSizes: [1], workingDays: 5, shiftMinutes: 450 })
    expect(h).toEqual({ machineHours: 112.5, operatorHours: null, hours: 112.5 })
  })

  it('operator limit caps the hours: 26 operators, 15 lines, 5 days, 7,5 h → 975 h of 1687,5 h', () => {
    const h = operatorWeekHours({
      crewSizes: Array(15).fill(1),
      workingDays: 5,
      weeklyOperators: 26,
      shiftMinutes: 450,
    })
    expect(h).toEqual({ machineHours: 1687.5, operatorHours: 975, hours: 975 })
  })
})
