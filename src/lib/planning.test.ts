import { describe, expect, it } from 'vitest'

import {
  buildDemandSchedule,
  buildRawMaterialPlan,
  buildWeekBuckets,
  materialsMissingRawSpec,
  computeRunPlan,
  type ProductSpec,
  splitByMoldLimit,
  weekTotalMinutes,
  weekTotalShifts,
} from './planning'

const baseMonday = new Date('2026-09-14T00:00:00Z')
const noProducts = new Map<string, ProductSpec>()

describe('buildDemandSchedule', () => {
  it('bakiyesi olan malzemeyi backlog fazına koyar ve en üste alır', () => {
    const entries = buildDemandSchedule(
      [
        { material: 'A', overdue: -500, periods: [{ label: 'W1', qty: -1000 }], stock: 0 },
        { material: 'B', overdue: 0, periods: [{ label: 'W1', qty: -1000 }], stock: 5000 },
      ],
      noProducts,
      { baseMonday },
    )
    expect(entries[0].material).toBe('A')
    expect(entries[0].phase).toBe('backlog')
    expect(entries[0].urgency).toBe(100)
    expect(entries[0].dueDate).toBe('2026-09-14')
  })

  it('ZPP kovalarını takvim haftalarına bağlar', () => {
    const entries = buildDemandSchedule(
      [
        {
          material: 'A',
          overdue: 0,
          periods: [
            { label: 'W38', qty: 1000 },
            { label: 'W39', qty: 1000 },
            { label: 'W40', qty: 1000 },
          ],
          stock: 0,
        },
      ],
      noProducts,
      { baseMonday },
    )
    expect(entries.map((e) => e.dueDate)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28'])
  })

  it('stoğu en erken ihtiyaçtan başlayarak düşer (FIFO)', () => {
    const entries = buildDemandSchedule(
      [
        {
          material: 'A',
          overdue: 0,
          periods: [
            { label: 'W1', qty: 1000 },
            { label: 'W2', qty: 1000 },
          ],
          stock: 1400,
        },
      ],
      noProducts,
      { baseMonday },
    )
    // İlk hafta tamamen stoktan karşılanır, ikinci haftadan 400 düşer.
    expect(entries).toHaveLength(1)
    expect(entries[0].dueDate).toBe('2026-09-21')
    expect(entries[0].qty).toBe(600)
  })

  it('aciliyeti stok kaç gün yeter üzerinden türetir', () => {
    // Haftada 1000 adet tüketim, 5 iş günü => günde 200. 200 stok = 1 gün.
    const entries = buildDemandSchedule(
      [{ material: 'A', overdue: 0, periods: [{ label: 'W1', qty: 1000 }], stock: 200 }],
      noProducts,
      { baseMonday },
    )
    expect(entries[0].daysOfCover).toBe(1)
    expect(entries[0].phase).toBe('urgent')
    expect(entries[0].urgency).toBeGreaterThan(80)
    // Acil kalem plan başında üretilebilir.
    expect(entries[0].earliestDate).toBe('2026-09-14')
  })

  it('stoğu uzun süre yeten malzemeyi dolgu fazına koyar ve erken üretmez', () => {
    const entries = buildDemandSchedule(
      [
        {
          material: 'B',
          overdue: 0,
          periods: [
            { label: 'W1', qty: 1000 },
            { label: 'W2', qty: 1000 },
            { label: 'W3', qty: 1000 },
            { label: 'W4', qty: 1000 },
          ],
          stock: 3000,
        },
      ],
      noProducts,
      { baseMonday },
    )
    // günde 200, 3000 stok = 15 gün => dolgu
    expect(entries).toHaveLength(1)
    expect(entries[0].phase).toBe('fill')
    expect(entries[0].daysOfCover).toBe(15)
    // Dolgu kalemi kendi haftasından önce üretilmez.
    expect(entries[0].earliestDate).toBe(entries[0].dueDate)
    expect(entries[0].earliestDate).toBe('2026-10-05')
  })

  it('eş üründen çıkan miktarı eş ürünün talebinden düşer', () => {
    const products = new Map<string, ProductSpec>([['A', { code: 'A', coProduct: 'B' }]])
    const entries = buildDemandSchedule(
      [
        { material: 'A', overdue: 0, periods: [{ label: 'W1', qty: 1000 }], stock: 0 },
        { material: 'B', overdue: 0, periods: [{ label: 'W1', qty: 800 }], stock: 0 },
      ],
      products,
      { baseMonday },
    )
    // A üretilirken B de çıkar => B'nin 800'ü karşılanır, listede kalmaz.
    expect(entries.map((e) => e.material)).toEqual(['A'])
  })

  it('eş üründen artan talep listede kalır', () => {
    const products = new Map<string, ProductSpec>([['A', { code: 'A', coProduct: 'B' }]])
    const entries = buildDemandSchedule(
      [
        { material: 'A', overdue: 0, periods: [{ label: 'W1', qty: 600 }], stock: 0 },
        { material: 'B', overdue: 0, periods: [{ label: 'W1', qty: 1000 }], stock: 0 },
      ],
      products,
      { baseMonday },
    )
    const b = entries.find((e) => e.material === 'B')!
    expect(b.qty).toBe(400)
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

describe('çalışma günleri (workingDays) kısıtı', () => {
  const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
  const monday = new Date('2026-09-14T00:00:00Z')

  it('normal vardiyaları yalnızca tanımlı çalışma günlerine koyar', () => {
    // Şirket Salı–Cumartesi çalışıyor: Pazartesi normal vardiya almamalı.
    const buckets = buildWeekBuckets(
      monday,
      { workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 },
      settings,
      new Set(),
      ['TU', 'WE', 'TH', 'FR', 'SA'],
    )
    const normal = buckets.filter((b) => b.shifts > 0 && !b.isOvertime)
    expect(normal.map((b) => b.dayKey)).toEqual(['TU', 'WE', 'TH', 'FR', 'SA'])
    expect(buckets.find((b) => b.dayKey === 'MO')!.minutes).toBe(0)
  })

  it('çalışma günü verilmezse tüm günler uygundur (eski davranış)', () => {
    const buckets = buildWeekBuckets(
      monday,
      { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 2 },
      settings,
    )
    expect(buckets.slice(0, 5).every((b) => b.shifts === 3 && !b.isOvertime)).toBe(true)
    expect(buckets[5].isOvertime).toBe(true)
  })

  it('mesai vardiyaları çalışma günü olmayan güne de konabilir', () => {
    const buckets = buildWeekBuckets(
      monday,
      { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 2 },
      settings,
      new Set(),
      ['MO', 'TU', 'WE', 'TH', 'FR'],
    )
    const saturday = buckets.find((b) => b.dayKey === 'SA')!
    expect(saturday.isOvertime).toBe(true)
    expect(saturday.shifts).toBe(2)
  })
})

describe('buildRawMaterialPlan', () => {
  const products = new Map<string, ProductSpec>([
    ['A', { code: 'A', rawMaterialCode: 'SAC-1', grossWeight: 2 }],
    ['B', { code: 'B', rawMaterialCode: 'SAC-1', grossWeight: 1 }],
    ['C', { code: 'C', rawMaterialCode: 'SAC-2', grossWeight: 3 }],
    ['D', { code: 'D' }],
  ])

  it('vuruş × brüt ağırlıktan hammadde ihtiyacını hammadde bazında toplar', () => {
    const needs = buildRawMaterialPlan(
      [
        { material: 'A', shots: 1000 },
        { material: 'B', shots: 500 },
        { material: 'C', shots: 100 },
      ],
      products,
      new Map(),
    )
    const sac1 = needs.find((n) => n.rawMaterial === 'SAC-1')!
    expect(sac1.requiredKg).toBe(2500) // 1000×2 + 500×1
    expect(sac1.materials).toEqual(['A', 'B'])
    expect(needs.find((n) => n.rawMaterial === 'SAC-2')!.requiredKg).toBe(300)
  })

  it('stokla karşılaştırıp eksiği hesaplar', () => {
    const needs = buildRawMaterialPlan(
      [{ material: 'A', shots: 1000 }],
      products,
      new Map([['SAC-1', 1500]]),
    )
    expect(needs[0].availableKg).toBe(1500)
    expect(needs[0].shortageKg).toBe(500)
  })

  it('stok yeterliyse eksik sıfırdır', () => {
    const needs = buildRawMaterialPlan(
      [{ material: 'A', shots: 100 }],
      products,
      new Map([['SAC-1', 5000]]),
    )
    expect(needs[0].shortageKg).toBe(0)
  })

  it('hammadde kodu tanımsız mamulü atlar ve ayrıca raporlar', () => {
    const jobs = [
      { material: 'A', shots: 100 },
      { material: 'D', shots: 100 },
    ]
    const needs = buildRawMaterialPlan(jobs, products, new Map())
    expect(needs.map((n) => n.rawMaterial)).toEqual(['SAC-1'])
    expect(materialsMissingRawSpec(jobs, products)).toEqual(['D'])
  })
})

describe('vardiya molası', () => {
  const monday = new Date('2026-09-14T00:00:00Z')

  it('her vardiyadan mola süresini düşer', () => {
    const buckets = buildWeekBuckets(
      monday,
      { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 },
      { shiftMinutes: 480, overtimeShiftMinutes: 480, breakMinutesPerShift: 30 },
    )
    // 3 vardiya × (480 − 30) = 1350
    expect(buckets[0].minutes).toBe(1350)
  })

  it('mesai vardiyalarından da düşer', () => {
    const buckets = buildWeekBuckets(
      monday,
      { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 2 },
      { shiftMinutes: 480, overtimeShiftMinutes: 480, breakMinutesPerShift: 30 },
    )
    expect(buckets[5].minutes).toBe(900) // 2 × 450
  })

  it('mola vardiyadan uzunsa kapasite negatife düşmez', () => {
    const buckets = buildWeekBuckets(
      monday,
      { workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 },
      { shiftMinutes: 60, overtimeShiftMinutes: 60, breakMinutesPerShift: 120 },
    )
    expect(buckets[0].minutes).toBe(0)
  })

  it('haftalık toplam da moladan arındırılmış olur', () => {
    const pattern = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 2 }
    expect(
      weekTotalMinutes(pattern, {
        shiftMinutes: 480,
        overtimeShiftMinutes: 480,
        breakMinutesPerShift: 30,
      }),
    ).toBe(17 * 450)
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
