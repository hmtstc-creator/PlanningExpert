import { describe, expect, it } from 'vitest'

import { monthSlot, type KpiEntry } from './kpi'
import { lineEntry, seriesLines, seriesSlots, seriesTotal, slotOfDate, slotRows } from './kpiSeries'

const e = (
  num: number,
  line: number,
  operatorType: 'direct' | 'indirect',
  plan = {},
  actual = {},
  costCenter = 'CC1',
  year = 2026,
  period: 'month' | 'week' = 'month',
): KpiEntry => ({
  period,
  year,
  num,
  costCenter,
  line,
  operatorType,
  plan,
  actual,
})

const MONTHS = seriesSlots('month', 2026, 1)

describe('KPI dizi görünümü', () => {
  it('dönemler: aylıkta yılın 12 ayı, haftalıkta seçilen haftayla biten 13 hafta (yıl geçişi dahil)', () => {
    expect(MONTHS.map((s) => s.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const w = seriesSlots('week', 2026, 3)
    expect(w).toHaveLength(13)
    expect(w[0]).toMatchObject({ year: 2025, num: 43 })
    expect(w[12]).toMatchObject({ year: 2026, num: 3 })
  })

  it('kayıt yoksa boş bir Direct satır', () => {
    expect(seriesLines([], 'month', MONTHS, 'CC1')).toEqual([{ operatorType: 'direct', k: 0, cells: {} }])
  })

  it('satırlar tip ve sırayla eşleşir; satır numarası dönemden döneme farklı olabilir', () => {
    const lines = seriesLines(
      [
        e(1, 0, 'direct', { operators: 10 }),
        e(1, 1, 'indirect', { operators: 3 }),
        e(2, 0, 'indirect', { operators: 4 }),
        e(2, 0, 'direct', { operators: 99 }, {}, 'OTHER'),
        e(2, 0, 'direct', { operators: 77 }, {}, 'CC1', 2025),
      ],
      'month',
      MONTHS,
      'CC1',
    )
    expect(lines.map((l) => l.operatorType)).toEqual(['direct', 'indirect'])
    expect(lines[0].cells['2026-01'].plan.operators).toBe(10)
    expect(lines[0].cells['2026-02']).toBeUndefined()
    expect(lines[1].cells['2026-02'].plan.operators).toBe(4)
  })

  it('haftalık: yıl geçişinde doğru haftaya', () => {
    const slots = seriesSlots('week', 2026, 2)
    const lines = seriesLines(
      [e(52, 0, 'direct', { operators: 5 }, {}, 'CC1', 2025, 'week'), e(52, 0, 'direct', { operators: 9 }, {}, 'CC1', 2026, 'week')],
      'week',
      slots,
      'CC1',
    )
    expect(Object.keys(lines[0].cells)).toEqual(['2025-52'])
  })

  it('kayıt: boş satır o dönem yazılmaz, sıra korunur', () => {
    const lines = seriesLines([e(1, 0, 'direct', { operators: 10 }), e(3, 0, 'indirect', {}, { volume: 5 })], 'month', MONTHS, 'CC1')
    expect(slotRows(lines, '2026-01')).toEqual([{ operatorType: 'direct', plan: { operators: 10 }, actual: {} }])
    expect(slotRows(lines, '2026-02')).toEqual([])
    expect(slotRows(lines, '2026-03')).toEqual([{ operatorType: 'indirect', plan: {}, actual: { volume: 5 } }])
  })

  it('toplam sütunu: saatler toplanır, operatör sayısı ortalama, oranlar toplamdan', () => {
    const lines = seriesLines(
      [
        e(1, 0, 'direct', { operators: 10, presenceHours: 100, overtimeHours: 10 }),
        e(2, 0, 'direct', { operators: 20, presenceHours: 300, overtimeHours: 30 }),
      ],
      'month',
      MONTHS,
      'CC1',
    )
    const t = seriesTotal(
      MONTHS.map((s) => lineEntry(lines[0], 'month', s, 'CC1')),
      [],
    )
    expect(t.plan.operators).toBe(15)
    expect(t.plan.presenceHours).toBe(400)
    expect(t.plan.overtimePct).toBeCloseTo(0.1)
    expect(t.actual.operators).toBeNull()
  })

  it('günün dönemi', () => {
    expect(slotOfDate(MONTHS, '2026-03-31')).toEqual(monthSlot(2026, 3))
    expect(slotOfDate(seriesSlots('week', 2026, 2), '2026-01-01')?.num).toBe(1)
    expect(slotOfDate(MONTHS, '2027-01-01')).toBeNull()
  })
})

describe('Excel’den yapıştırma', () => {
  it('ızgara', async () => {
    const { parseGrid } = await import('./kpiSeries')
    expect(parseGrid('1\t2\t3\r\n4\t5\t6\r\n')).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
    expect(parseGrid('7')).toEqual([['7']])
  })

  it('Türkçe ve İngilizce sayı biçimi', async () => {
    const { cleanPasted } = await import('./kpiSeries')
    expect(cleanPasted('1.234,5')).toBe('1234.5')
    expect(cleanPasted('1,234.5')).toBe('1234.5')
    expect(cleanPasted('3,5')).toBe('3.5')
    expect(cleanPasted('3,5 %')).toBe('3.5')
    expect(cleanPasted('1.234.567')).toBe('1234567')
    expect(cleanPasted('12.5')).toBe('12.5')
    expect(cleanPasted('2.000')).toBe('2000')
    expect(cleanPasted('12,500')).toBe('12500')
    expect(cleanPasted('0,035')).toBe('0.035')
    expect(cleanPasted('132')).toBe('132')
    expect(cleanPasted('  ')).toBe('')
  })
})
