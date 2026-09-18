// Uçtan uca entegrasyon testi: ZPP talebi → hafta bazlı talep havuzu →
// kapasite kovaları → yerleştirme. Katmanların birbirine doğru bağlandığını
// ve kısıtların bir arada çalıştığını doğrular.

import { describe, expect, it } from 'vitest'

import {
  buildDemandSchedule,
  buildRawMaterialPlan,
  buildWeekBuckets,
  type DayBucket,
  type DemandInput,
  type ProductSpec,
} from './planning'
import { schedule, type PlanOverride, type PressSpec } from './scheduler'

const monday = new Date('2026-09-14T00:00:00Z')
const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
const schedulerOptions = { setupGapMinutes: 60, concurrentSetupsPerHall: 1 }

const presses: PressSpec[] = [
  { name: 'PRS-1', hall: 'Hol 1' },
  { name: 'PRS-2', hall: 'Hol 1' },
  { name: 'PRS-3', hall: 'Hol 2' },
]

const products = new Map<string, ProductSpec>([
  [
    'MAM-A',
    {
      code: 'MAM-A',
      coProduct: 'MAM-B',
      moldCavities: 2,
      spm: 40,
      grossWeight: 1.2,
      coilWeight: 6000,
      rawMaterialCode: 'SAC-3',
      setupMinutes: 45,
      coilSetupMinutes: 10,
      maxShots: 20_000,
      mainMachine: 'PRS-1',
      altMachine1: 'PRS-2',
    },
  ],
  [
    'MAM-B',
    {
      code: 'MAM-B',
      moldCavities: 1,
      spm: 30,
      grossWeight: 0.8,
      coilWeight: 6000,
      rawMaterialCode: 'SAC-3',
      setupMinutes: 30,
      coilSetupMinutes: 10,
      mainMachine: 'PRS-3',
    },
  ],
  [
    'MAM-C',
    {
      code: 'MAM-C',
      moldCavities: 1,
      spm: 50,
      grossWeight: 2,
      coilWeight: 8000,
      rawMaterialCode: 'SAC-9',
      setupMinutes: 60,
      coilSetupMinutes: 15,
      mainMachine: 'PRS-2',
    },
  ],
])

const demandRows: DemandInput[] = [
  {
    material: 'MAM-A',
    overdue: -3000,
    periods: [
      { label: 'W38', qty: 8000 },
      { label: 'W39', qty: 8000 },
      { label: 'W40', qty: 8000 },
      { label: 'W41', qty: 8000 },
    ],
    stock: 2000,
  },
  {
    material: 'MAM-B',
    overdue: 0,
    periods: [
      { label: 'W38', qty: 4000 },
      { label: 'W39', qty: 4000 },
    ],
    stock: 0,
  },
  {
    material: 'MAM-C',
    overdue: 0,
    periods: [
      { label: 'W38', qty: 2000 },
      { label: 'W39', qty: 2000 },
    ],
    stock: 500,
  },
]

function buildBuckets(holidays: Set<string>): Map<string, DayBucket[]> {
  const map = new Map<string, DayBucket[]>()
  for (const press of presses) {
    const all: DayBucket[] = []
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(monday)
      weekStart.setDate(weekStart.getDate() + w * 7)
      all.push(
        ...buildWeekBuckets(
          weekStart,
          { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 },
          settings,
          holidays,
          ['MO', 'TU', 'WE', 'TH', 'FR'],
        ),
      )
    }
    map.set(press.name, all)
  }
  return map
}

function runPipeline(
  holidays = new Set<string>(),
  overrides: PlanOverride[] = [],
) {
  const demand = buildDemandSchedule(demandRows, products, {
    baseMonday: monday,
    horizonWeeks: 4,
  })
  const buckets = buildBuckets(holidays)
  const result = schedule(demand, products, presses, buckets, settings, {
    ...schedulerOptions,
    overrides,
  })
  return { demand, buckets, result }
}

describe('planlama hattı (uçtan uca)', () => {
  it('bakiyeyi ilk gün planlar ve talebi preslere dağıtır', () => {
    const { result } = runPipeline()
    expect(result.jobs.length).toBeGreaterThan(0)

    const backlog = result.jobs.filter((j) => j.phase === 'backlog')
    expect(backlog.length).toBeGreaterThan(0)
    expect(backlog[0].date).toBe('2026-09-14')
    expect(new Set(result.jobs.map((j) => j.press)).size).toBeGreaterThan(1)
  })

  it('eş üründen çıkan miktar eş ürünün talebinden düşülür', () => {
    const { demand } = runPipeline()
    const plannedA = demand
      .filter((e) => e.material === 'MAM-A')
      .reduce((s, e) => s + e.qty, 0)
    const plannedB = demand
      .filter((e) => e.material === 'MAM-B')
      .reduce((s, e) => s + e.qty, 0)
    const rawBDemand = 8000 // 4000 + 4000

    expect(plannedA).toBeGreaterThan(rawBDemand)
    // A'dan çıkan eş ürün B'nin tüm talebini karşılar.
    expect(plannedB).toBe(0)
  })

  it('tatil gününe hiçbir iş yerleştirilmez', () => {
    const holiday = '2026-09-16'
    const { result } = runPipeline(new Set([holiday]))
    expect(result.jobs.some((j) => j.date === holiday)).toBe(false)
  })

  it('hafta sonuna iş yerleştirilmez (çalışma günü tanımı)', () => {
    const { result } = runPipeline()
    const weekendDates = new Set(['2026-09-19', '2026-09-20', '2026-09-26', '2026-09-27'])
    expect(result.jobs.some((j) => weekendDates.has(j.date))).toBe(false)
  })

  it('aynı holdeki setuplar en az bir saat arayla planlanır', () => {
    const { result } = runPipeline()
    const byDateHall = new Map<string, number[]>()
    for (const job of result.jobs) {
      if (job.setupMinutes <= 0) continue
      const key = `${job.date}|${job.hall}`
      const list = byDateHall.get(key) ?? []
      list.push(job.setupStartMinute)
      byDateHall.set(key, list)
    }
    for (const starts of byDateHall.values()) {
      const sorted = starts.slice().sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(60)
      }
    }
  })

  it('aynı kalıbın iki işi zaman olarak çakışmaz', () => {
    const { result } = runPipeline()
    const byMaterialDate = new Map<string, { start: number; end: number }[]>()
    for (const job of result.jobs) {
      const key = `${job.material}|${job.date}`
      const list = byMaterialDate.get(key) ?? []
      list.push({ start: job.setupStartMinute, end: job.endMinute })
      byMaterialDate.set(key, list)
    }
    for (const intervals of byMaterialDate.values()) {
      const sorted = intervals.slice().sort((a, b) => a.start - b.start)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end)
      }
    }
  })

  it('hiçbir iş presin gün kapasitesini aşmaz', () => {
    const { buckets, result } = runPipeline()
    for (const job of result.jobs) {
      const bucket = buckets.get(job.press)!.find((b) => b.date === job.date)!
      expect(job.endMinute).toBeLessThanOrEqual(bucket.minutes)
    }
  })

  it('kalıp limitini aşan parti bölünür', () => {
    const { result } = runPipeline()
    for (const job of result.jobs) {
      const max = products.get(job.material)?.maxShots
      if (max) expect(job.shots).toBeLessThanOrEqual(max)
    }
  })

  it('müdahaleler hattın sonunda etkisini gösterir', () => {
    const { result } = runPipeline(new Set(), [
      { material: 'MAM-C', kind: 'exclude' },
      { material: 'MAM-A', kind: 'pin', press: 'PRS-2' },
    ])
    expect(result.jobs.some((j) => j.material === 'MAM-C')).toBe(false)
    expect(
      result.unplanned.some(
        (u) => u.material === 'MAM-C' && u.reason.includes('Excluded from planning'),
      ),
    ).toBe(true)
    const aJobs = result.jobs.filter((j) => j.material === 'MAM-A')
    expect(aJobs.length).toBeGreaterThan(0)
    expect(aJobs.every((j) => j.press === 'PRS-2')).toBe(true)
  })

  it('hammadde ihtiyacı planlanan işlerden hesaplanır', () => {
    const { result } = runPipeline()
    const needs = buildRawMaterialPlan(result.jobs, products, new Map([['SAC-3', 1000]]))
    const sac3 = needs.find((n) => n.rawMaterial === 'SAC-3')
    expect(sac3).toBeDefined()
    expect(sac3!.requiredKg).toBeGreaterThan(0)
    expect(sac3!.shortageKg).toBeGreaterThan(0)
  })
})
