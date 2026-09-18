import { describe, expect, it } from 'vitest'

import { addDays, isoDate, mondayOf } from './dates'

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
