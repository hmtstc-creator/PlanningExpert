import { describe, expect, it } from 'vitest'

import type { KpiEntry } from './kpi'
import { lineEntry, monthRows, yearLines, yearTotal } from './kpiYear'

const e = (num: number, line: number, operatorType: 'direct' | 'indirect', plan = {}, actual = {}, costCenter = 'CC1'): KpiEntry => ({
  period: 'month',
  year: 2026,
  num,
  costCenter,
  line,
  operatorType,
  plan,
  actual,
})

describe('KPI yıl görünümü', () => {
  it('kayıt yoksa boş bir Direct satır', () => {
    expect(yearLines([], 'CC1')).toEqual([{ operatorType: 'direct', k: 0, months: {} }])
  })

  it('satırlar tip ve sırayla eşleşir; satır numarası aydan aya farklı olabilir', () => {
    const lines = yearLines(
      [
        e(1, 0, 'direct', { operators: 10 }),
        e(1, 1, 'indirect', { operators: 3 }),
        // Şubat: yalnızca Indirect, satır 0.
        e(2, 0, 'indirect', { operators: 4 }),
        e(2, 0, 'direct', { operators: 99 }, {}, 'OTHER'),
      ],
      'CC1',
    )
    expect(lines.map((l) => l.operatorType)).toEqual(['direct', 'indirect'])
    expect(lines[0].months[1].plan.operators).toBe(10)
    expect(lines[0].months[2]).toBeUndefined()
    expect(lines[1].months[1].plan.operators).toBe(3)
    expect(lines[1].months[2].plan.operators).toBe(4)
  })

  it('kayıt: boş satır o ay yazılmaz, sıra korunur', () => {
    const lines = yearLines([e(1, 0, 'direct', { operators: 10 }), e(3, 0, 'indirect', {}, { volume: 5 })], 'CC1')
    expect(monthRows(lines, 1)).toEqual([{ operatorType: 'direct', plan: { operators: 10 }, actual: {} }])
    expect(monthRows(lines, 2)).toEqual([])
    expect(monthRows(lines, 3)).toEqual([{ operatorType: 'indirect', plan: {}, actual: { volume: 5 } }])
  })

  it('yıl sütunu: saatler toplanır, operatör sayısı ortalama, oranlar toplamdan', () => {
    const lines = yearLines(
      [
        e(1, 0, 'direct', { operators: 10, presenceHours: 100, overtimeHours: 10 }),
        e(2, 0, 'direct', { operators: 20, presenceHours: 300, overtimeHours: 30 }),
      ],
      'CC1',
    )
    const t = yearTotal(
      [1, 2].map((n) => lineEntry(lines[0], 2026, n, 'CC1')),
      [],
    )
    expect(t.plan.operators).toBe(15)
    expect(t.plan.presenceHours).toBe(400)
    expect(t.plan.overtimePct).toBeCloseTo(0.1)
    expect(t.actual.operators).toBeNull()
  })
})

describe('Excel’den yapıştırma', () => {
  it('ızgara', async () => {
    const { parseGrid } = await import('./kpiYear')
    expect(parseGrid('1\t2\t3\r\n4\t5\t6\r\n')).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
    expect(parseGrid('7')).toEqual([['7']])
  })

  it('Türkçe ve İngilizce sayı biçimi', async () => {
    const { cleanPasted } = await import('./kpiYear')
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
