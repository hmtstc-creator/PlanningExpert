import { describe, expect, it } from 'vitest'

import {
  buildWeekBuckets,
  type DayBucket,
  type DemandEntry,
  type ProductSpec,
} from './planning'
import { schedule, type PlanOverride } from './scheduler'

const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
const options = { setupGapMinutes: 60, concurrentSetupsPerHall: 1 }
const monday = new Date('2026-09-14T00:00:00Z')

function bucketsFor(presses: string[], shiftsPerDay = 3): Map<string, DayBucket[]> {
  const map = new Map<string, DayBucket[]>()
  for (const p of presses) {
    map.set(p, buildWeekBuckets(monday, { workingDays: 5, shiftsPerDay, overtimeShifts: 0 }, settings))
  }
  return map
}

const baseProduct: ProductSpec & { mainMachine?: string } = {
  code: 'A',
  moldCavities: 1,
  spm: 100,
  grossWeight: 1,
  coilWeight: 10_000,
  setupMinutes: 30,
  coilSetupMinutes: 15,
  mainMachine: 'PRS-1',
}

const backlogEntry: DemandEntry = {
  material: 'A',
  qty: 500,
  dueDate: '2026-09-14',
  earliestDate: '2026-09-14',
  bucketLabel: 'Bakiye',
  phase: 'backlog',
  urgency: 100,
  daysOfCover: 0,
}

describe('schedule', () => {
  it('bakiyeyi uygun prese ilk günde yerleştirir', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0].press).toBe('PRS-1')
    expect(result.jobs[0].date).toBe('2026-09-14')
    expect(result.jobs[0].reason).toContain('Bakiye')
  })

  it('aynı holde iki setupu en az bir saat arayla planlar', () => {
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...baseProduct, mainMachine: 'PRS-1' }],
      ['B', { ...baseProduct, code: 'B', mainMachine: 'PRS-2' }],
    ])
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      products,
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 1' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.jobs).toHaveLength(2)
    const [first, second] = result.jobs
    expect(Math.abs(second.setupStartMinute - first.setupStartMinute)).toBeGreaterThanOrEqual(60)
  })

  it('farklı hollerdeki setuplar aynı anda başlayabilir', () => {
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...baseProduct, mainMachine: 'PRS-1' }],
      ['B', { ...baseProduct, code: 'B', mainMachine: 'PRS-2' }],
    ])
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      products,
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.jobs.map((j) => j.setupStartMinute)).toEqual([0, 0])
  })

  it('aynı kalıbı aynı anda iki preste çalıştırmaz ama aynı güne planlayabilir', () => {
    const product = { ...baseProduct, altMachine1: 'PRS-2' }
    const result = schedule(
      [backlogEntry, { ...backlogEntry, qty: 400 }],
      new Map([['A', product]]),
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs).toHaveLength(2)
    // Eski davranış aynı malzemeyi aynı güne koymuyordu; artık koyabilir.
    expect(result.jobs[0].date).toBe(result.jobs[1].date)
    // Ama aynı kalıbın iki işi zaman olarak çakışamaz.
    const [a, b] = [...result.jobs].sort((x, y) => x.setupStartMinute - y.setupStartMinute)
    expect(b.setupStartMinute).toBeGreaterThanOrEqual(a.endMinute)
  })

  it('dolgu işini kendi haftasından önce planlamaz', () => {
    const fill: DemandEntry = {
      material: 'A',
      qty: 500,
      dueDate: '2026-09-17',
      earliestDate: '2026-09-17',
      bucketLabel: 'W38',
      phase: 'fill',
      urgency: 0,
      daysOfCover: 30,
    }
    const result = schedule(
      [fill],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs[0].date).toBe('2026-09-17')
    expect(result.jobs[0].late).toBe(false)
  })

  it('ihtiyaç haftasından sonraya kayan işi geç olarak işaretler', () => {
    const past: DemandEntry = {
      ...backlogEntry,
      dueDate: '2026-09-10',
      earliestDate: '2026-09-14',
    }
    const result = schedule(
      [past],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs[0].late).toBe(true)
    expect(result.jobs[0].reason).toContain('geç')
  })

  it('kalıp limitini aşan üretimi partilere bölerek planlar', () => {
    const limited = { ...baseProduct, maxShots: 300 }
    const result = schedule(
      [backlogEntry],
      new Map([['A', limited]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs.length).toBeGreaterThan(1)
    expect(result.jobs.every((j) => j.shots <= 300)).toBe(true)
  })

  it('pres tanımlı değilse gerekçesiyle planlanamadı listesine yazar', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', { ...baseProduct, mainMachine: 'YOK' }]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('pres yok')
  })

  it('kapasite yetmezse planlanamadı listesine gerekçe yazar', () => {
    const huge = { ...backlogEntry, qty: 10_000_000 }
    const result = schedule(
      [huge],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1'], 1),
      settings,
      options,
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('kapasite')
  })

  it('eş ürün miktarını işte taşır', () => {
    const withCo = { ...baseProduct, coProduct: 'B' }
    const result = schedule(
      [backlogEntry],
      new Map([['A', withCo]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs[0].coProduct).toBe('B')
    expect(result.jobs[0].coProductQuantity).toBe(500)
  })

  it('hariç tutulan malzemeyi planlamaz ve gerekçesini yazar', () => {
    const overrides: PlanOverride[] = [{ material: 'A', kind: 'exclude' }]
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('hariç tuttu')
  })

  it('sabitlenen malzemeyi yalnızca o preste planlar', () => {
    const product = { ...baseProduct, altMachine1: 'PRS-2' }
    const overrides: PlanOverride[] = [{ material: 'A', kind: 'pin', press: 'PRS-2' }]
    const result = schedule(
      [backlogEntry],
      new Map([['A', product]]),
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs[0].press).toBe('PRS-2')
    expect(result.jobs[0].pinned).toBe(true)
    expect(result.jobs[0].reason).toContain('sabitledi')
  })

  it('sabitlenen gün dışına taşmaz', () => {
    const overrides: PlanOverride[] = [
      { material: 'A', kind: 'pin', press: 'PRS-1', date: '2026-09-16' },
    ]
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs[0].date).toBe('2026-09-16')
  })

  it('sabitlenen pres tanımsızsa gerekçesiyle planlanamadıya düşer', () => {
    const overrides: PlanOverride[] = [{ material: 'A', kind: 'pin', press: 'YOK' }]
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('Sabitlenen pres tanımlı değil')
  })

  it('öne alınan malzemeyi faz sırasından bağımsız olarak ilk sıraya koyar', () => {
    const fill: DemandEntry = {
      material: 'B',
      qty: 500,
      dueDate: '2026-09-14',
      earliestDate: '2026-09-14',
      bucketLabel: 'W38',
      phase: 'fill',
      urgency: 0,
      daysOfCover: 30,
    }
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...baseProduct, mainMachine: 'PRS-1' }],
      ['B', { ...baseProduct, code: 'B', mainMachine: 'PRS-1' }],
    ])
    const overrides: PlanOverride[] = [{ material: 'B', kind: 'priority' }]
    const result = schedule(
      [backlogEntry, fill],
      products,
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    // Bakiye normalde önce gelirdi; öne alma kuralı B'yi başa taşır.
    expect(result.jobs[0].material).toBe('B')
    expect(result.jobs[0].setupStartMinute).toBe(0)
  })
})
