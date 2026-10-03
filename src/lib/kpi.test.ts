import { describe, expect, it } from 'vitest'

import { isoWeekMonday, isoWeeksInYear, kpiFor, monthSlot, trendSlots, weekSlot, type KpiEntry } from './kpi'

const e = (costCenter: string, plan: KpiEntry['plan'], actual: KpiEntry['actual'], operatorType: 'direct' | 'indirect' = 'direct'): KpiEntry => ({
  period: 'month', year: 2026, num: 9, costCenter, operatorType, plan, actual,
})

describe('KPI hesapları', () => {
  it('saatler toplanır; Efficiency ve Overtime % toplamdan; girilen yüzdeler saatle ağırlıklı', () => {
    const r = kpiFor(
      [
        e('A', { presenceHours: 1000, overtimeHours: 100, productionHours: 880, absenteeism: 0.03, productivity: 12.5, operators: 10, oee: 0.8 }, { presenceHours: 900, overtimeHours: 200, productionHours: 770, absenteeism: 0.05, operators: 9 }),
        e('A', { presenceHours: 100, overtimeHours: 50, productionHours: 75, absenteeism: 0.1, productivity: 8, operators: 2, oee: 0.6 }, { presenceHours: 100, overtimeHours: 0, productionHours: 50, operators: 3 }, 'indirect'),
      ],
      [],
    )
    expect(r.plan.overtimePct).toBeCloseTo(150 / 1100)
    expect(r.plan.totalPresenceHours).toBe(1250)
    expect(r.plan.efficiency).toBeCloseTo(955 / 1250)
    expect(r.plan.absenteeismPct).toBeCloseTo((0.03 * 1000 + 0.1 * 100) / 1100)
    expect(r.plan.productivity).toBeCloseTo((12.5 * 1100 + 8 * 150) / 1250)
    // Yalnızca bir satırda girilmiş: o değer.
    expect(r.actual.absenteeismPct).toBeCloseTo(0.05)
    expect(r.actual.productivity).toBeNull()
    expect(r.actual.operators).toBe(12)
    expect(r.actual.operatorsDirect).toBe(9)
    expect(r.actual.operatorsIndirect).toBe(3)
    expect(r.plan.oee).toBeCloseTo((0.8 * 880 + 0.6 * 75) / 955)
  })

  it('gerçekleşen OEE kök veriden; adet ve saat girilmemişse OEE verisinden', () => {
    const r = kpiFor(
      [e('A', {}, { volume: 500 }), e('B', {}, {})],
      [
        { costCenter: 'A', good: 999, operatingMin: 300, productionMin: 360, loadingMin: 480 },
        { costCenter: 'B', good: 200, operatingMin: 120, productionMin: 240, loadingMin: 480 },
      ],
    )
    expect(r.actual.oee).toBeCloseTo(420 / 960)
    expect(r.actual.volume).toBe(500 + 200)
    expect(r.actual.productionHours).toBeCloseTo((360 + 240) / 60)
    expect(r.fromOee).toEqual({ volume: true, productionHours: true })
  })

  it('boş alan boş kalır (0 sayılmaz)', () => {
    const r = kpiFor([e('A', {}, {})], [])
    expect(r.actual.volume).toBeNull()
    expect(r.actual.overtimePct).toBeNull()
    expect(r.actual.oee).toBeNull()
  })
})

describe('KPI dönemleri — ölçü sabit', () => {
  it('aylık trend her zaman Ocak–Aralık 12 ay', () => {
    expect(trendSlots('month', 2026, 1).map((s) => s.label)).toEqual(trendSlots('month', 2026, 12).map((s) => s.label))
    expect(trendSlots('month', 2026, 1)).toHaveLength(12)
    expect(monthSlot(2028, 2)).toMatchObject({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('haftalık trend seçilen haftayla biten 13 hafta, yıl geçişiyle', () => {
    const s = trendSlots('week', 2026, 2)
    expect(s).toHaveLength(13)
    expect(s[12]).toMatchObject({ year: 2026, num: 2 })
    expect(s[0].year).toBe(2025)
    expect(isoWeeksInYear(2026)).toBe(53)
    expect(isoWeeksInYear(2025)).toBe(52)
    expect(isoWeekMonday(2026, 1)).toBe('2025-12-29')
    expect(weekSlot(2026, 39)).toMatchObject({ from: '2026-09-21', to: '2026-09-27' })
  })
})
