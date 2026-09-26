import { describe, expect, it } from 'vitest'

import { capacityModel } from './capacityModel'
import { dayOvertime, patternProblem, pressDay, type PressDaySources } from './pressCalendar'

const full = { id: 'full', name: 'Full overtime', startMinute: 420, durationMinutes: 480 }
const half = { id: 'half', name: 'Half overtime', startMinute: 420, durationMinutes: 240 }
const third = { id: 'third', name: 'Third shift', startMinute: 1380, durationMinutes: 480 }

function sources(over: Partial<PressDaySources> = {}): PressDaySources {
  return {
    shiftStartMinute: 420,
    shiftMinutes: 480,
    templates: new Map([['P1', { workingDays: 5, shiftsPerDay: 2 }]]),
    weekOverrides: new Map(),
    datedOvertime: new Map(),
    definitions: new Map([full, half, third].map((d) => [d.id, d])),
    holidays: new Set(),
    ...over,
  }
}

describe('press calendar rules (docs/decisions.md)', () => {
  it('a day cannot exceed 24 hours', () => {
    expect(patternProblem({ workingDays: 5, shiftsPerDay: 3 }, 480)).toBeNull()
    expect(patternProblem({ workingDays: 5, shiftsPerDay: 3 }, 540)).toMatch(/24 hours/)
    expect(patternProblem({ workingDays: 5, shiftsPerDay: 2 }, 540)).toBeNull()
  })

  it('overtime must not overlap the normal shifts nor run past the production day', () => {
    // 2 vardiya 07:00–23:00: 23:00'dan 8 saat = 3. vardiya, sığar.
    expect(dayOvertime(2, 420, 480, [third]).problems).toEqual([])
    // Normal vardiyayla çakışan tam mesai reddedilir.
    expect(dayOvertime(2, 420, 480, [full]).problems[0]).toMatch(/overlaps the normal shifts/)
    // 3 vardiya + 3. vardiya mesaisi 24 saati aşar.
    expect(dayOvertime(3, 420, 480, [third]).problems[0]).toMatch(/overlaps|24 hours/)
  })

  it('a public holiday is lost, not moved; overtime on a holiday is opened by date', () => {
    const src = sources({
      holidays: new Set(['2026-09-16']),
      datedOvertime: new Map([['P1|2026-09-16', [{ press: 'P1', date: '2026-09-16', definitionId: 'full' }]]]),
    })
    const wed = pressDay(src, 'P1', '2026-09-14', '2026-09-16')
    expect(wed.shifts).toBe(0)
    expect(wed.overtime).toHaveLength(1)
    expect(pressDay(src, 'P1', '2026-09-14', '2026-09-19').shifts).toBe(0)
  })

  it('recurring overtime runs every week, but not on a holiday', () => {
    const src = sources({
      templates: new Map([['P1', { workingDays: 5, shiftsPerDay: 2, recurringOvertime: [{ dayKey: 'SA', definitionId: 'half' }] }]]),
      holidays: new Set(['2026-09-26']),
    })
    expect(pressDay(src, 'P1', '2026-09-14', '2026-09-19').overtime).toEqual([{ start: 420, end: 660, name: 'Half overtime' }])
    expect(pressDay(src, 'P1', '2026-09-21', '2026-09-26').overtime).toEqual([])
  })

  it('a press without a Work Calendar pattern has no capacity', () => {
    const model = capacityModel({
      shiftMinutes: 480,
      shiftStartMinute: 420,
      plannedStops: [],
      templates: [{ press: 'P1', workingDays: 5, shiftsPerDay: 2 }],
      holidays: new Set(),
    })
    const monday = new Date('2026-09-14T00:00:00Z')
    expect(model.hasCalendar('P2')).toBe(false)
    expect(model.weekBuckets('P2', monday).every((b) => b.minutes === 0)).toBe(true)
    expect(model.weekBuckets('P1', monday).reduce((a, b) => a + b.minutes, 0)).toBe(5 * 960)
  })

  it('planned stops falling inside overtime are deducted too', () => {
    const model = capacityModel({
      shiftMinutes: 480,
      shiftStartMinute: 420,
      plannedStops: [{ shiftIndex: 1, name: 'Lunch', kind: 'meal', startMinute: 690, durationMinutes: 30 }],
      templates: [{ press: 'P1', workingDays: 5, shiftsPerDay: 1 }],
      overtimeDefinitions: [full],
      pressOvertime: [{ press: 'P1', date: '2026-09-19', definitionId: 'full' }],
      holidays: new Set(),
    })
    const saturday = model.weekBuckets('P1', new Date('2026-09-14T00:00:00Z'))[5]
    expect(saturday.isOvertime).toBe(true)
    expect(saturday.minutes).toBe(450)
  })

  it('plant working day = not a holiday and at least one press has a normal shift', () => {
    const model = capacityModel({
      shiftMinutes: 480,
      shiftStartMinute: 420,
      plannedStops: [],
      templates: [
        { press: 'P1', workingDays: 5, shiftsPerDay: 2 },
        { press: 'P2', workingDays: 6, shiftsPerDay: 1 },
      ],
      holidays: new Set(['2026-09-16']),
    })
    expect(model.isPlantWorkingDate('2026-09-16')).toBe(false)
    expect(model.isPlantWorkingDate('2026-09-19')).toBe(true) // P2 Cumartesi çalışıyor
    expect(model.isPlantWorkingDate('2026-09-20')).toBe(false)
  })
})

describe('server error text', () => {
  it('keeps only the message the planner should read', async () => {
    const { serverErrorText } = await import('./pressCalendar')
    const e = new Error(
      '[CONVEX M(overtime:addPressOvertime)] [Request ID: abc] Server Error\nUncaught Error: Full overtime 07:00–15:00 overlaps the normal shifts 07:00–23:00.\n    at handler (../convex/overtime.ts:120:9)\n\n  Called by client',
    )
    expect(serverErrorText(e)).toBe('Full overtime 07:00–15:00 overlaps the normal shifts 07:00–23:00.')
  })
})
