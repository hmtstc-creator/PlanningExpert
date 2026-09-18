import { describe, expect, it } from 'vitest'

import {
  buildAdherence,
  capacityUtilisation,
  performanceFactor,
  theoreticalMinutes,
} from './performance'
import type { ProductSpec } from './planning'

const plan = [
  { material: 'A', date: '2026-09-14', quantity: 1000 },
  { material: 'A', date: '2026-09-15', quantity: 500 },
  { material: 'B', date: '2026-09-14', quantity: 800 },
  { material: 'C', date: '2026-09-30', quantity: 999 },
]

const actual = [
  { material: 'A', postingDate: '2026-09-14', quantity: 900 },
  { material: 'A', postingDate: '2026-09-15', quantity: 400 },
  { material: 'B', postingDate: '2026-09-14', quantity: 800 },
  { material: 'D', postingDate: '2026-09-15', quantity: 100 },
]

describe('buildAdherence', () => {
  it('malzeme bazında plan ve gerçekleşeni yan yana koyar', () => {
    const rows = buildAdherence(plan, actual, '2026-09-14', '2026-09-20')
    const a = rows.find((r) => r.material === 'A')!
    expect(a.plannedQty).toBe(1500)
    expect(a.actualQty).toBe(1300)
    expect(a.diff).toBe(-200)
    expect(a.ratio).toBeCloseTo(1300 / 1500)
  })

  it('tarih aralığı dışındaki kalemleri saymaz', () => {
    const rows = buildAdherence(plan, actual, '2026-09-14', '2026-09-20')
    expect(rows.find((r) => r.material === 'C')).toBeUndefined()
  })

  it('planda olmayıp üretilen malzemeyi de listeler', () => {
    const rows = buildAdherence(plan, actual, '2026-09-14', '2026-09-20')
    const d = rows.find((r) => r.material === 'D')!
    expect(d.plannedQty).toBe(0)
    expect(d.actualQty).toBe(100)
    expect(d.ratio).toBeNull()
  })
})

describe('performanceFactor', () => {
  it('toplam gerçekleşen / toplam planlanan olarak hesaplar', () => {
    const rows = buildAdherence(plan, actual, '2026-09-14', '2026-09-20')
    // planlanan 2300, gerçekleşen 2200
    expect(performanceFactor(rows)).toBeCloseTo(2200 / 2300)
  })

  it('plan yoksa faktör uydurmaz', () => {
    expect(performanceFactor([])).toBeNull()
    expect(
      performanceFactor([
        { material: 'X', plannedQty: 0, actualQty: 50, diff: 50, ratio: null },
      ]),
    ).toBeNull()
  })
})

describe('theoreticalMinutes', () => {
  const products = new Map<string, ProductSpec>([
    ['A', { code: 'A', moldCavities: 2, spm: 50 }],
    ['B', { code: 'B' }],
  ])

  it('adet / göz / spm üzerinden teorik süreyi bulur', () => {
    // 1000 adet, 2 göz => 500 vuruş, 50 spm => 10 dakika
    expect(
      theoreticalMinutes([{ material: 'A', postingDate: '2026-09-14', quantity: 1000 }], products),
    ).toBe(10)
  })

  it('spm veya göz tanımsız mamulü atlar', () => {
    expect(
      theoreticalMinutes([{ material: 'B', postingDate: '2026-09-14', quantity: 1000 }], products),
    ).toBe(0)
  })
})

describe('capacityUtilisation', () => {
  it('teorik süre / açık kapasite oranını verir', () => {
    expect(capacityUtilisation(480, 960)).toBe(0.5)
  })

  it('kapasite sıfırsa oran hesaplamaz', () => {
    expect(capacityUtilisation(100, 0)).toBeNull()
  })
})
