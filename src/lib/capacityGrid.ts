// Builds the press × week capacity grid shown on the Work Calendar page.
//
// Each press has a standard weekly pattern (its template) and may have
// exception weeks (overrides). The grid resolves which applies to each week,
// counts the holidays that fall in it, and works out how much capacity the
// week actually has — holidays remove a working day, so a week with the same
// pattern is not always worth the same number of shifts.

import { DAY_KEYS } from './planning'
import { addDays, isoDate } from './dates'

export interface WeekPattern {
  workingDays: number
  shiftsPerDay: number
  overtimeShifts: number
}

export interface GridCell {
  press: string
  weekStart: string
  pattern: WeekPattern
  /** True when this week uses an override rather than the press template. */
  overridden: boolean
  /** Public or manual holidays falling on a would-be working day. */
  holidayCount: number
  /** Shifts after holidays are removed. */
  effectiveShifts: number
  effectiveMinutes: number
}

export interface GridInput {
  presses: { name: string; hall: string }[]
  templates: Map<string, WeekPattern>
  /** key: `${press}|${weekStart}` */
  overrides: Map<string, WeekPattern>
  weekStarts: Date[]
  holidays: Set<string>
  /** Which weekdays may carry normal shifts. */
  workingDayKeys: string[]
  shiftMinutes: number
  overtimeShiftMinutes: number
  defaultPattern: WeekPattern
}

/**
 * Holidays that land on a day the pattern would have used for a normal shift.
 * Days beyond the pattern's working-day count are already idle, so a holiday
 * there costs nothing.
 */
export function holidaysCostingCapacity(
  weekStart: Date,
  pattern: WeekPattern,
  holidays: Set<string>,
  workingDayKeys: string[],
): number {
  const allowed = new Set(workingDayKeys.length > 0 ? workingDayKeys : DAY_KEYS)
  let normalDaysLeft = pattern.workingDays
  let lost = 0

  for (let i = 0; i < 7 && normalDaysLeft > 0; i++) {
    const dayKey = DAY_KEYS[i]
    if (!allowed.has(dayKey)) continue
    if (holidays.has(isoDate(addDays(weekStart, i)))) {
      lost++
      normalDaysLeft--
      continue
    }
    normalDaysLeft--
  }
  return lost
}

export function buildGrid(input: GridInput): GridCell[] {
  const cells: GridCell[] = []

  for (const press of input.presses) {
    const template = input.templates.get(press.name) ?? input.defaultPattern
    for (const weekStart of input.weekStarts) {
      const key = `${press.name}|${isoDate(weekStart)}`
      const override = input.overrides.get(key)
      const pattern = override ?? template

      const holidayCount = holidaysCostingCapacity(
        weekStart,
        pattern,
        input.holidays,
        input.workingDayKeys,
      )
      const normalDays = Math.max(0, pattern.workingDays - holidayCount)
      const effectiveShifts = normalDays * pattern.shiftsPerDay + pattern.overtimeShifts

      cells.push({
        press: press.name,
        weekStart: isoDate(weekStart),
        pattern,
        overridden: !!override,
        holidayCount,
        effectiveShifts,
        effectiveMinutes:
          normalDays * pattern.shiftsPerDay * input.shiftMinutes +
          pattern.overtimeShifts * input.overtimeShiftMinutes,
      })
    }
  }

  return cells
}

/**
 * Maps a shift count onto 0–4 intensity steps, relative to the busiest cell.
 * A single-hue ramp reads as magnitude; zero gets its own empty step so an
 * idle week is obvious rather than just pale.
 */
export function intensityStep(shifts: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (shifts <= 0) return 0
  if (max <= 0) return 1
  const ratio = shifts / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}
