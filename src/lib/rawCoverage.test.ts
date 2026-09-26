import { describe, expect, it } from 'vitest'

import { buildRawConsumption, coverageOf } from './rawCoverage'

const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']

describe('raw material coverage', () => {
  it('spreads a job over its run minutes and skips co-products', () => {
    const plan = buildRawConsumption({
      jobs: [
        {
          material: 'A',
          quantity: 1000,
          segments: [
            { kind: 'setup', date: '2026-09-14', start: 0, end: 30 },
            { kind: 'run', date: '2026-09-14', start: 30, end: 130 },
            { kind: 'run', date: '2026-09-15', start: 0, end: 300 },
          ],
        },
        { material: 'B', quantity: 1000, segments: [{ kind: 'run', date: '2026-09-14', start: 0, end: 10 }] },
      ],
      products: new Map([
        ['A', { code: 'A', coProduct: 'B', rawMaterialCode: 'R1', grossWeight: 2 }],
        ['B', { code: 'B', rawMaterialCode: 'R1', grossWeight: 2 }],
      ]),
      rawStockKg: new Map([['R1', 700]]),
      dates,
    })
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].kgByDay).toEqual([500, 1500, 0, 0, 0])
    expect(plan.items[0].stockKg).toBe(700)
  })

  it('keeps N days of consumption on hand and adds the standard extra to each order', () => {
    // 3 000 kg/gün, stok yok, 2 günlük hedef, +500 kg.
    const cov = coverageOf(
      { rawMaterial: 'R1', materials: ['A'], stockKg: 0, kgByDay: [3000, 3000, 3000, 0, 0] },
      dates,
      { coverageDays: 2, extraKg: 500 },
    )
    // Gün 1: hedef 6 000, stok 0 → 6 500. Gün 2 başı: 3 500, hedef 6 000 → 3 000.
    expect(cov.orders.map((o) => [o.date, o.kg])).toEqual([
      ['2026-09-14', 6500],
      ['2026-09-15', 3000],
    ])
    expect(cov.runsOutOn).toBe('2026-09-14')
    // Her gün başında stok hedefi karşılar.
    for (const d of cov.days) expect(d.stockKg).toBeGreaterThanOrEqual(d.targetKg)
  })

  it('the user example: need 3 t → order 3.5 t', () => {
    const cov = coverageOf({ rawMaterial: 'R1', materials: [], stockKg: 0, kgByDay: [3000, 0, 0, 0, 0] }, dates, {
      coverageDays: 10,
      extraKg: 500,
    })
    expect(cov.orders).toEqual([{ date: '2026-09-14', rawMaterial: 'R1', kg: 3500, stockBeforeKg: 0, targetKg: 3000 }])
  })

  it('no order when stock covers the window; reports days of cover', () => {
    const cov = coverageOf({ rawMaterial: 'R1', materials: [], stockKg: 2500, kgByDay: [1000, 1000, 1000, 1000, 0] }, dates, {
      coverageDays: 1,
      extraKg: 500,
    })
    expect(cov.coversDays).toBe(2.5)
    expect(cov.runsOutOn).toBe('2026-09-16')
    expect(cov.orders[0].date).toBe('2026-09-16')
  })
})
