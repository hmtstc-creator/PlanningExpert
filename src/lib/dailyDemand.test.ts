import { describe, expect, it } from 'vitest'

import { interpretDayLabels, parseDayLabel, readDailyDemand, splitWeek } from './dailyDemand'
import { buildDemandSchedule } from './planning'

describe('ZPP_DAILY column headers', () => {
  it('reads European, ISO and Excel default formats', () => {
    expect(parseDayLabel('16.09.2026')).toBe('2026-09-16')
    expect(parseDayLabel('Wed 16.09.26')).toBe('2026-09-16')
    expect(parseDayLabel('2026-09-16')).toBe('2026-09-16')
    expect(parseDayLabel('9/16/26', 'mdy')).toBe('2026-09-16')
    expect(parseDayLabel('W38')).toBeNull()
  })

  it('works out day/month order from the sequence of days', () => {
    // 9/14 … 9/18 yalnızca ay/gün okumasında geçerli ve sıralı.
    const labels = ['9/14/26', '9/15/26', '9/16/26', '9/17/26', '9/18/26']
    expect(Array.from(interpretDayLabels(labels).values())).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
    ])
    // 01.10 … 05.10: iki okuma da tarih verir, ama yalnızca gün/ay sıralı.
    const eu = ['01.10.2026', '02.10.2026', '03.10.2026', '04.10.2026', '05.10.2026']
    expect(interpretDayLabels(eu).get('02.10.2026')).toBe('2026-10-02')
  })

  it('reports headers it cannot read and the last day covered', () => {
    const daily = readDailyDemand([
      { material: 'A', periods: [{ label: '16.09.2026', qty: -5000 }, { label: 'Total', qty: -5000 }] },
    ])
    expect(daily.until).toBe('2026-09-16')
    expect(daily.unreadable).toEqual(['Total'])
    expect(daily.byMaterial.get('A')).toEqual([{ date: '2026-09-16', qty: 5000 }])
  })
})

describe('splitWeek', () => {
  const week = {
    weekStart: '2026-09-14',
    weekEnd: '2026-09-20',
    today: '2026-09-14',
    openDays: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'],
  }

  it('puts the whole week on its sales day when the daily file covers the week', () => {
    const r = splitWeek({
      ...week,
      weeklyQty: 5000,
      daily: [{ date: '2026-09-16', qty: 5000 }],
      dailyUntil: '2026-09-27',
    })
    expect(r.total).toBe(5000)
    expect(Array.from(r.perDay)).toEqual([['2026-09-16', 5000]])
  })

  it('spreads the rest of a partly covered week over the uncovered days', () => {
    const r = splitWeek({
      ...week,
      weeklyQty: 5000,
      daily: [{ date: '2026-09-15', qty: 2000 }],
      dailyUntil: '2026-09-16',
    })
    expect(r.total).toBe(5000)
    expect(r.perDay.get('2026-09-15')).toBe(2000)
    expect(r.perDay.get('2026-09-17')).toBe(1500)
    expect(r.perDay.get('2026-09-18')).toBe(1500)
  })

  it('falls back to an even spread without daily data', () => {
    const r = splitWeek({ ...week, weeklyQty: 5000, dailyUntil: null })
    expect(r.perDay.get('2026-09-14')).toBe(1000)
  })
})

describe('lot timing with ZPP_DAILY', () => {
  it('plans for the sales day, not an even spread', () => {
    // Haftalık 5000, stok 3000. Eşit yayılsa stok Perşembe biterdi (günde
    // 1000). Oysa 5000'in hepsi Çarşamba sevk ediliyor: stok Çarşamba biter.
    const row = {
      material: 'A',
      overdue: 0,
      periods: [{ label: 'W38', qty: -5000 }],
      stock: 3000,
    }
    const options = {
      baseMonday: new Date(2026, 8, 14),
      horizonWeeks: 1,
      today: '2026-09-14',
      safetyStockDays: 1,
    }
    const weekly = buildDemandSchedule([row], new Map(), options)
    expect(weekly[0].dueDate).toBe('2026-09-17')

    const daily = buildDemandSchedule(
      [{ ...row, daily: [{ date: '2026-09-16', qty: 5000 }] }],
      new Map(),
      { ...options, dailyUntil: '2026-09-20' },
    )
    expect(daily[0].dueDate).toBe('2026-09-16')
    expect(daily[0].earliestDate).toBe('2026-09-15')
    expect(daily[0].qty).toBe(2000)
  })
})
