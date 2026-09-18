import { describe, expect, it } from 'vitest'

import { addDays, isoDate, isoWeek, isoWeekLabel, isoWeekYear, mondayOf } from './dates'

describe('isoDate', () => {
  it('uses the local calendar date, not UTC', () => {
    // Local midnight east of UTC falls on the previous UTC day. Using
    // toISOString() here returned 2026-09-13 and shifted the whole plan.
    const localMidnight = new Date(2026, 8, 14, 0, 0, 0, 0)
    expect(isoDate(localMidnight)).toBe('2026-09-14')
  })

  it('pads single-digit months and days', () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('stays on the same day late in the evening', () => {
    expect(isoDate(new Date(2026, 8, 14, 23, 59))).toBe('2026-09-14')
  })
})

describe('mondayOf', () => {
  it('returns the Monday of the same week', () => {
    // 18 Sep 2026 is a Friday.
    expect(isoDate(mondayOf(new Date(2026, 8, 18)))).toBe('2026-09-14')
  })

  it('treats Sunday as the end of the week, not the start', () => {
    expect(isoDate(mondayOf(new Date(2026, 8, 20)))).toBe('2026-09-14')
  })

  it('returns the same day when given a Monday', () => {
    expect(isoDate(mondayOf(new Date(2026, 8, 14)))).toBe('2026-09-14')
  })
})

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(isoDate(addDays(new Date(2026, 8, 30), 2))).toBe('2026-10-02')
  })

  it('does not mutate the input', () => {
    const d = new Date(2026, 8, 14)
    addDays(d, 5)
    expect(isoDate(d)).toBe('2026-09-14')
  })
})

describe('isoWeek', () => {
  it('numbers a mid-year week', () => {
    // Monday 14 September 2026 is in ISO week 38.
    expect(isoWeek(new Date(2026, 8, 14))).toBe(38)
    expect(isoWeek(new Date(2026, 8, 20))).toBe(38) // Sunday, same week
    expect(isoWeek(new Date(2026, 8, 21))).toBe(39)
  })

  it('puts 1 January in the previous year week when it falls late in the week', () => {
    // 1 January 2027 is a Friday, so it belongs to week 53 of 2026.
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53)
    expect(isoWeekYear(new Date(2027, 0, 1))).toBe(2026)
  })

  it('puts late December in week 1 when the week has its Thursday in January', () => {
    // 31 December 2025 is a Wednesday; its Thursday is 1 January 2026.
    expect(isoWeek(new Date(2025, 11, 31))).toBe(1)
    expect(isoWeekYear(new Date(2025, 11, 31))).toBe(2026)
  })

  it('starts the year at week 1 when 1 January is a Thursday', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1)
  })

  it('formats a padded label', () => {
    expect(isoWeekLabel(new Date(2026, 8, 14))).toBe('2026-W38')
    expect(isoWeekLabel(new Date(2026, 0, 5))).toBe('2026-W02')
  })
})
