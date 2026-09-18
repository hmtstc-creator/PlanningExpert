import { describe, expect, it } from 'vitest'

import { buildMoldLife } from './moldLife'
import type { ProductSpec } from './planning'

const products = new Map<string, ProductSpec>([
  ['A', { code: 'A', moldCavities: 2, maxShots: 1000 }],
  ['B', { code: 'B', moldCavities: 1, maxShots: 500 }],
  ['C', { code: 'C', moldCavities: 1 }], // limit tanımsız
])

const actual = [
  { material: 'A', postingDate: '2026-09-01', quantity: 1000 }, // 500 vuruş
  { material: 'A', postingDate: '2026-09-10', quantity: 600 }, // 300 vuruş
  { material: 'B', postingDate: '2026-09-05', quantity: 600 }, // 600 vuruş, limit 500
  { material: 'C', postingDate: '2026-09-05', quantity: 100 },
]

describe('buildMoldLife', () => {
  it('adedi göz sayısına bölerek vuruşa çevirir', () => {
    const rows = buildMoldLife(actual, products)
    expect(rows.find((r) => r.material === 'A')!.cumulativeShots).toBe(800)
  })

  it('limiti aşan kalıbı exceeded olarak işaretler ve başa alır', () => {
    const rows = buildMoldLife(actual, products)
    expect(rows[0].material).toBe('B')
    expect(rows[0].status).toBe('exceeded')
    expect(rows[0].remainingShots).toBe(0)
  })

  it('limite yaklaşan kalıbı uyarır', () => {
    const rows = buildMoldLife(actual, products)
    const a = rows.find((r) => r.material === 'A')!
    expect(a.usageRatio).toBe(0.8)
    expect(a.status).toBe('warning')
    expect(a.remainingShots).toBe(200)
  })

  it('limit tanımsızsa uydurmaz', () => {
    const rows = buildMoldLife(actual, products)
    const c = rows.find((r) => r.material === 'C')!
    expect(c.status).toBe('unknown')
    expect(c.maxShots).toBeNull()
    expect(c.usageRatio).toBeNull()
  })

  it('son bakım tarihinden önceki üretimi saymaz', () => {
    const rows = buildMoldLife(actual, products, new Map([['A', '2026-09-05']]))
    const a = rows.find((r) => r.material === 'A')!
    // Yalnızca 10 Eylül'deki 600 adet = 300 vuruş sayılır.
    expect(a.cumulativeShots).toBe(300)
    expect(a.status).toBe('ok')
    expect(a.lastMaintenance).toBe('2026-09-05')
  })

  it('bakım yapılmış ama üretim görmemiş kalıbı da listeler', () => {
    const rows = buildMoldLife([], products, new Map([['A', '2026-09-05']]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ material: 'A', cumulativeShots: 0, status: 'ok' })
  })
})
