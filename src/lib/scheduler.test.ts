import { describe, expect, it } from 'vitest'

import { buildWeekBuckets, type DayBucket, type ProductSpec } from './planning'
import { schedule } from './scheduler'

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

const poolItem = {
  material: 'A',
  overdue: 500,
  horizonNeed: 0,
  grossNeed: 500,
  netNeed: 500,
  weeklyAvg: 500,
  dailyRate: 100,
  daysOfCover: 0,
  urgency: 100,
  phase: 'backlog' as const,
}

describe('schedule', () => {
  it('bakiyeyi uygun prese ilk günde yerleştirir', () => {
    const result = schedule(
      [poolItem],
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
      [poolItem, { ...poolItem, material: 'B' }],
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
      [poolItem, { ...poolItem, material: 'B' }],
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

  it('aynı kalıbı (malzeme) aynı gün iki preste çalıştırmaz', () => {
    const product = { ...baseProduct, altMachine1: 'PRS-2' }
    const result = schedule(
      [poolItem, { ...poolItem, netNeed: 400 }],
      new Map([['A', product]]),
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    const dates = result.jobs.map((j) => j.date)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('kalıp limitini aşan üretimi partilere bölerek planlar', () => {
    const limited = { ...baseProduct, maxShots: 300 }
    const result = schedule(
      [poolItem],
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
      [poolItem],
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
    const huge = { ...poolItem, netNeed: 10_000_000 }
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
      [poolItem],
      new Map([['A', withCo]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs[0].coProduct).toBe('B')
    expect(result.jobs[0].coProductQuantity).toBe(500)
  })
})
