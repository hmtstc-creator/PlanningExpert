import { describe, expect, it } from 'vitest'

import { capacityModel } from './capacityModel'
import {
  dayOvertime,
  dayShiftsProblem,
  freeMinutes,
  freeWindows,
  overtimeFitProblem,
  patternProblem,
  pressDay,
  type PressDaySources,
} from './pressCalendar'

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
    expect(dayOvertime(2, 420, 480, [full]).problems[0]).toMatch(/overlaps the normal shift/)
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

describe('free window: where overtime fits (planlamacı 2026-10-29)', () => {
  it('3 × 8 h fills the day — overtime fits only on a day that is not full (e.g. the closed Saturday)', () => {
    // Üç vardiya 07:00–07:00: gün dolu, hiçbir mesai sığmaz.
    expect(freeWindows(3, 420, 480)).toEqual([])
    expect(freeMinutes(3, 420, 480)).toBe(0)
    expect(overtimeFitProblem(third, 3, 420, 480)).toMatch(/overlaps the normal shift/)
    // Kapalı cumartesi: gün bütünüyle boş, aynı mesai sığar.
    expect(freeWindows(0, 420, 480)).toEqual([{ start: 420, end: 1860 }])
    expect(overtimeFitProblem(third, 0, 420, 480)).toBeNull()
    expect(overtimeFitProblem(full, 0, 420, 480)).toBeNull()
  })

  it('two 9 h 40 min shifts from 06:30 leave 01:50–06:30 free — a night overtime fits there', () => {
    const start = 390 // 06:30
    const len = 580 // 9 s 40 dk → 06:30–16:10 ve 16:10–01:50
    expect(freeWindows(2, start, len)).toEqual([{ start: 1550, end: 1830 }]) // 01:50–06:30
    expect(freeMinutes(2, start, len)).toBe(280)
    const night = { name: 'Night', startMinute: 110, durationMinutes: 280 } // 01:50, 4 s 40 dk
    expect(overtimeFitProblem(night, 2, start, len)).toBeNull()
    // 10 dakika uzunu üretim gününü aşar (gün 06:30'da biter).
    expect(overtimeFitProblem({ ...night, durationMinutes: 290 }, 2, start, len)).toMatch(/24 hours/)
    // Gece mesaisi açıldıktan sonra gün dolar.
    const windows = dayOvertime(2, start, len, [night]).windows
    expect(freeWindows(2, start, len, windows)).toEqual([])
    expect(overtimeFitProblem(night, 2, start, len, [night])).toMatch(/overlaps another overtime/)
  })

  it('a day record with a gap leaves that gap free (only the 1st and 3rd shift)', () => {
    // 1. ve 3. vardiya açık: 15:00–23:00 boş kalır.
    expect(freeWindows([1, 3], 420, 480)).toEqual([{ start: 900, end: 1380 }])
    expect(overtimeFitProblem({ name: 'Mid', startMinute: 900, durationMinutes: 480 }, [1, 3], 420, 480)).toBeNull()
  })
})

describe('day record (Production Plan → Work calendar)', () => {
  // Şablon 5 gün × 2 vardiya (07:00–23:00). Gün kaydı her şeyin önüne geçer.
  it('opens a single non-consecutive shift: only the 3rd, 23:00–07:00', () => {
    const wed = pressDay(sources({ dayShifts: new Map([['P1|2026-09-16', [3]]]) }), 'P1', '2026-09-14', '2026-09-16')
    expect(wed).toMatchObject({ shifts: 1, activeShifts: [3], fromDayRecord: true })
    const model = capacityModel({
      shiftMinutes: 480,
      shiftStartMinute: 420,
      plannedStops: [{ shiftIndex: 3, name: 'Meal', kind: 'meal', startMinute: 180, durationMinutes: 30 }],
      templates: [{ press: 'P1', workingDays: 5, shiftsPerDay: 2 }],
      dayShifts: [{ press: 'P1', date: '2026-09-16', shifts: [3] }],
      holidays: new Set(),
    })
    const day = model.weekBuckets('P1', new Date('2026-09-14T00:00:00Z'))[2]
    // 480 dk vardiya − 30 dk 3. vardiya yemeği = 450 net dk.
    expect(day).toMatchObject({ shifts: 1, activeShifts: [3], minutes: 450, shiftNetMinutes: [450] })
  })

  it('wins over the pattern and a holiday; 1..n stays a plain count', () => {
    const src = sources({
      holidays: new Set(['2026-09-16']),
      dayShifts: new Map([
        ['P1|2026-09-16', [1]],
        ['P1|2026-09-17', []],
        ['P1|2026-09-19', [2, 1]],
      ]),
    })
    expect(pressDay(src, 'P1', '2026-09-14', '2026-09-16').shifts).toBe(1) // tatil, gün kaydıyla açık
    expect(pressDay(src, 'P1', '2026-09-14', '2026-09-17').shifts).toBe(0) // iş günü, kapatıldı
    const sat = pressDay(src, 'P1', '2026-09-14', '2026-09-19')
    expect(sat.shifts).toBe(2)
    expect(sat.activeShifts).toBeUndefined()
  })

  it('a shift that overlaps the day overtime, or does not exist, is rejected', () => {
    const src = sources({
      dayShifts: new Map([['P1|2026-09-16', [1, 3]]]),
      datedOvertime: new Map([['P1|2026-09-16', [{ press: 'P1', date: '2026-09-16', definitionId: 'third' }]]]),
    })
    expect(pressDay(src, 'P1', '2026-09-14', '2026-09-16').problems[0]).toMatch(/overlaps the normal shift 23:00/)
    expect(dayShiftsProblem([4], 480)).toMatch(/shifts 1–3/)
    expect(dayShiftsProblem([1, 1], 480)).toMatch(/twice/)
    expect(dayShiftsProblem([2], 720)).toBeNull()
    expect(dayShiftsProblem([3], 720)).toMatch(/shifts 1–2/)
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
