import { describe, expect, it } from 'vitest'

import { buildGrid, holidaysCostingCapacity, intensityStep } from './capacityGrid'

const monday = new Date(2026, 8, 14) // Monday 14 September 2026
const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR']
const standard = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }

describe('holidaysCostingCapacity', () => {
  it('counts a holiday that falls on a working day', () => {
    const holidays = new Set(['2026-09-16']) // Wednesday
    expect(holidaysCostingCapacity(monday, standard, holidays, weekdays)).toBe(1)
  })

  it('ignores a holiday on a non-working weekday', () => {
    // Pattern only uses 3 days, so Thursday is idle anyway.
    const holidays = new Set(['2026-09-17'])
    expect(
      holidaysCostingCapacity(monday, { ...standard, workingDays: 3 }, holidays, weekdays),
    ).toBe(0)
  })

  it('ignores a weekend holiday when the week is Monday to Friday', () => {
    const holidays = new Set(['2026-09-19']) // Saturday
    expect(holidaysCostingCapacity(monday, standard, holidays, weekdays)).toBe(0)
  })

  it('counts several holidays in one week', () => {
    const holidays = new Set(['2026-09-15', '2026-09-17'])
    expect(holidaysCostingCapacity(monday, standard, holidays, weekdays)).toBe(2)
  })
})

describe('buildGrid', () => {
  const base = {
    presses: [{ name: 'PRS-1', hall: 'Hall 1' }],
    templates: new Map([['PRS-1', standard]]),
    overrides: new Map(),
    weekStarts: [monday],
    holidays: new Set<string>(),
    workingDayKeys: weekdays,
    shiftMinutes: 480,
    overtimeShiftMinutes: 480,
    defaultPattern: { workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 },
  }

  it('uses the press template when there is no override', () => {
    const [cell] = buildGrid(base)
    expect(cell.overridden).toBe(false)
    expect(cell.effectiveShifts).toBe(15)
    expect(cell.effectiveMinutes).toBe(15 * 480)
  })

  it('prefers an override over the template and marks it', () => {
    const [cell] = buildGrid({
      ...base,
      overrides: new Map([
        ['PRS-1|2026-09-14', { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 2 }],
      ]),
    })
    expect(cell.overridden).toBe(true)
    // Şablon/istisna haftadaki eski mesai sayısı okunmaz: mesai tarihli açılır.
    expect(cell.effectiveShifts).toBe(15)
  })

  it('removes the capacity a holiday takes away', () => {
    const [cell] = buildGrid({ ...base, holidays: new Set(['2026-09-16']) })
    expect(cell.holidayCount).toBe(1)
    expect(cell.effectiveShifts).toBe(12) // 4 days × 3 shifts
  })

  it('falls back to the default pattern for a press with no template', () => {
    const [cell] = buildGrid({ ...base, templates: new Map() })
    expect(cell.effectiveShifts).toBe(5)
  })

  it('uses the same net hours as the plan: planned stops are deducted', () => {
    const [cell] = buildGrid({ ...base, stopMinutesByShift: [30, 30, 30] })
    expect(cell.effectiveMinutes).toBe(15 * 450)
  })

  it('fills the days from Monday, like the plan: 6 days = Mon–Sat', () => {
    const [cell] = buildGrid({ ...base, templates: new Map([['PRS-1', { workingDays: 6, shiftsPerDay: 3, overtimeShifts: 0 }]]) })
    expect(cell.effectiveShifts).toBe(18)
  })

  it('produces one cell per press per week', () => {
    const cells = buildGrid({
      ...base,
      presses: [
        { name: 'PRS-1', hall: 'Hall 1' },
        { name: 'PRS-2', hall: 'Hall 1' },
      ],
      weekStarts: [monday, new Date(2026, 8, 21)],
    })
    expect(cells).toHaveLength(4)
  })
})

describe('intensityStep', () => {
  it('gives an idle week its own step', () => {
    expect(intensityStep(0, 17)).toBe(0)
  })

  it('rises with the shift count', () => {
    expect(intensityStep(4, 17)).toBe(1)
    expect(intensityStep(8, 17)).toBe(2)
    expect(intensityStep(12, 17)).toBe(3)
    expect(intensityStep(17, 17)).toBe(4)
  })

  it('does not divide by zero when nothing is planned', () => {
    expect(intensityStep(3, 0)).toBe(1)
  })
})
