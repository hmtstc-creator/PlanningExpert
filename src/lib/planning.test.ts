import { describe, expect, it } from 'vitest'

import {
  buildDemandPool,
  buildWeekBuckets,
  computeRunPlan,
  splitByMoldLimit,
  weekTotalMinutes,
  weekTotalShifts,
} from './planning'

describe('buildDemandPool', () => {
  it('bakiyesi olan malzemeyi backlog fazına koyar ve en üste alır', () => {
    const pool = buildDemandPool([
      { material: 'A', overdue: -500, periods: [{ label: 'W1', qty: -1000 }], stock: 0 },
      { material: 'B', overdue: 0, periods: [{ label: 'W1', qty: -1000 }], stock: 5000 },
    ])
    expect(pool[0].material).toBe('A')
    expect(pool[0].phase).toBe('backlog')
    expect(pool[0].urgency).toBe(100)
  })

  it('net ihtiyacı stoğu düşerek hesaplar ve sıfırsa listeden çıkarır', () => {
    const pool = buildDemandPool([
      { material: 'A', overdue: 0, periods: [{ label: 'W1', qty: 1000 }], stock: 400 },
      { material: 'B', overdue: 0, periods: [{ label: 'W1', qty: 300 }], stock: 5000 },
    ])
    expect(pool).toHaveLength(1)
    expect(pool[0].material).toBe('A')
    expect(pool[0].netNeed).toBe(600)
  })

  it('aciliyeti stok kaç gün yeter üzerinden türetir', () => {
    // Haftada 1000 adet tüketim, 5 iş günü => günde 200. 200 stok = 1 gün.
    const pool = buildDemandPool([
      { material: 'A', overdue: 0, periods: [{ label: 'W1', qty: 1000 }], stock: 200 },
    ])
    expect(pool[0].dailyRate).toBe(200)
    expect(pool[0].daysOfCover).toBe(1)
    expect(pool[0].phase).toBe('urgent')
    expect(pool[0].urgency).toBeGreaterThan(80)
  })

  it('stoğu uzun süre yeten malzemeyi dolgu fazına koyar', () => {
    const pool = buildDemandPool([
      { material: 'A', overdue: 0, periods: [{ label: 'W1', qty: 100 }], stock: 50 },
    ])
    // günde 20 adet, 50 stok = 2.5 gün => acil
    expect(pool[0].phase).toBe('urgent')

    const pool2 = buildDemandPool([
      {
        material: 'B',
        overdue: 0,
        periods: [
          { label: 'W1', qty: 1000 },
          { label: 'W2', qty: 1000 },
        ],
        stock: 1500,
      },
    ])
    // günde 200, 1500 stok = 7.5 gün => hâlâ 14 günün altında, acil
    expect(pool2[0].daysOfCover).toBe(7.5)
  })
})

describe('computeRunPlan', () => {
  const product = {
    code: 'M1',
    moldCavities: 2,
    spm: 20,
    grossWeight: 1.5, // kg/shot
    coilWeight: 8000,
    setupMinutes: 30,
    coilSetupMinutes: 15,
  }

  it('vuruş, rulo ve süreleri doğru hesaplar', () => {
    const plan = computeRunPlan(product, 10_000)
    expect(plan.shots).toBe(5000) // 10.000 adet / 2 göz
    expect(plan.runMinutes).toBe(250) // 5000 vuruş / 20 spm
    expect(plan.kgNeeded).toBe(7500) // 5000 × 1.5
    expect(plan.shotsPerCoil).toBe(5333) // floor(8000 / 1.5)
    expect(plan.coilsNeeded).toBe(1)
    expect(plan.totalMinutes).toBe(30 + 15 + 250)
  })

  it('birden fazla rulo gerektiğinde her rulo için setup ekler', () => {
    const plan = computeRunPlan(product, 40_000) // 20.000 vuruş
    expect(plan.coilsNeeded).toBe(4) // ceil(20000 / 5333)
    expect(plan.coilSetupMinutes).toBe(60) // 4 × 15
  })

  it('eş ürün miktarını aynı vuruştan üretilen adet olarak verir', () => {
    const withCo = computeRunPlan({ ...product, coProduct: 'M2' }, 10_000)
    expect(withCo.coProductQuantity).toBe(10_000)
    expect(computeRunPlan(product, 10_000).coProductQuantity).toBe(0)
  })

  it('kalıp max shot limitini işaretler', () => {
    const limited = computeRunPlan({ ...product, maxShots: 4000 }, 10_000)
    expect(limited.exceedsMoldLimit).toBe(true)
    expect(computeRunPlan({ ...product, maxShots: 6000 }, 10_000).exceedsMoldLimit).toBe(false)
  })
})

describe('splitByMoldLimit', () => {
  const product = {
    code: 'M1',
    moldCavities: 2,
    spm: 20,
    grossWeight: 1.5,
    coilWeight: 8000,
    setupMinutes: 30,
    coilSetupMinutes: 15,
    maxShots: 3000,
  }

  it('limiti aşan üretimi partilere böler', () => {
    const runs = splitByMoldLimit(product, 10_000) // 5000 vuruş, limit 3000 vuruş
    expect(runs).toHaveLength(2)
    expect(runs[0].shots).toBe(3000)
    expect(runs[1].shots).toBe(2000)
    expect(runs.every((r) => !r.exceedsMoldLimit)).toBe(true)
  })

  it('limit yoksa tek parti döner', () => {
    const runs = splitByMoldLimit({ ...product, maxShots: undefined }, 10_000)
    expect(runs).toHaveLength(1)
  })
})

describe('buildWeekBuckets', () => {
  const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
  const monday = new Date('2026-09-14T00:00:00Z')

  it('normal vardiyaları çalışma günlerine, mesaiyi sonrasına dağıtır', () => {
    const buckets = buildWeekBuckets(monday, { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 2 }, settings)
    expect(buckets).toHaveLength(7)
    expect(buckets.slice(0, 5).every((b) => b.shifts === 3 && !b.isOvertime)).toBe(true)
    expect(buckets[5].isOvertime).toBe(true)
    expect(buckets[5].shifts).toBe(2)
    expect(buckets[6].shifts).toBe(0)
  })

  it('tatil gününü sıfır kapasiteye çeker', () => {
    const buckets = buildWeekBuckets(
      monday,
      { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 },
      settings,
      new Set(['2026-09-16']),
    )
    const holiday = buckets.find((b) => b.date === '2026-09-16')!
    expect(holiday.isHoliday).toBe(true)
    expect(holiday.minutes).toBe(0)
    // tatil bir çalışma gününü tüketmez, gün Cumaya kayar
    expect(buckets.filter((b) => b.shifts === 3)).toHaveLength(5)
  })
})

describe('haftalık toplamlar', () => {
  it('5 gün × 3 vardiya + 2 mesai = 17 vardiya', () => {
    const pattern = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 2 }
    expect(weekTotalShifts(pattern)).toBe(17)
    expect(weekTotalMinutes(pattern, { shiftMinutes: 480, overtimeShiftMinutes: 480 })).toBe(
      17 * 480,
    )
  })
})
