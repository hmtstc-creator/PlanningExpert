import { describe, expect, it } from 'vitest'

import type { DemandEntry } from './planning'
import { computePlan, type PlanInputs } from './planPipeline'
import { splitLot } from './scheduler'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

// Tek pres (104), günde tek vardiya. Y'nin Min. lotu 6000 = iki rulo (3000'er),
// ama bugünkü ihtiyacı yalnızca 100 adet. Z kısa ve acil, aynı preste.
function plant(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    products: [
      { code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 3000, mainMachine: '104' },
      { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
    ],
    weeklyDemand: [
      { material: 'Y', overdue: -3000, periods: [] },
      { material: 'Z', overdue: 0, periods: [{ label: '2026-W38', qty: 200 }] },
    ],
    stock: [],
    locations: [{ code: '2009', countFinished: true, countRaw: true }, { code: '1009', countFinished: true, countRaw: true }],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { timeZone: 'Europe/Bucharest', shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 0 },
    workCalendar: null,
    officialHolidays: [],
    latestSnapshot: null,
    plannedStops: [],
    overrides: [{ material: 'Y', kind: 'quantity', bucket: 'Backlog', qty: 6000 }],
    moldMaintenance: [],
    readiness: [],
    pressMaintenance: [],
    alarms: [],
    truncatedInputs: [],
    ...overrides,
  }
}

describe('lot splitting in the scenario search', () => {
  it('splits a long lot so a short late lot runs between the parts', () => {
    // Y: ihtiyaç 3000, lot 6000 (iki rulo, planlamacı değeri). Z, Y'nin
    // arkasında kalınca teslimi kaçırır. Bölme olmadan çözüm yok: Y tam rulo
    // sınırında 3000 + 3000 olunca Z araya girer, hepsi zamanında.
    const run = computePlan(plant(), MONDAY_0700)
    expect(run.jobs.filter((j) => j.late)).toEqual([])
    expect(run.lateItems).toEqual([])
    const y = run.jobs.filter((j) => j.material === 'Y').sort((a, b) => a.setupStartMinute - b.setupStartMinute)
    const z = run.jobs.find((j) => j.material === 'Z')!
    expect(y.map((j) => j.quantity)).toEqual([3000, 3000])
    expect(y.map((j) => j.bucketLabel)).toEqual(['Backlog (1/2)', 'Backlog (2/2)'])
    // Z, iki parçanın arasında.
    expect(z.setupStartMinute).toBeGreaterThanOrEqual(y[0].endMinute)
    expect(z.setupStartMinute).toBeLessThan(y[1].setupStartMinute)
    // Her parça tam rulo, ikinci parça yeni setup ister.
    expect(y.every((j) => j.coilsNeeded === 1)).toBe(true)
    expect(y[1].setupMinutes).toBeGreaterThan(0)
    expect(y[1].reason).toContain('lot split 2/2')
    expect(run.optimisation?.localSearch?.lotSplits).toEqual([{ material: 'Y', bucketLabel: 'Backlog', parts: 2 }])
    // Bağımsız doğrulama bölünmüş planı bozuk bulmaz.
    const broken = (run.validation?.rules ?? []).filter((r) => r.broken > 0)
    expect(broken).toEqual([])
  })

  it('does not split when nothing is late', () => {
    const run = computePlan(plant({ weeklyDemand: [{ material: 'Y', overdue: -3000, periods: [] }] }), MONDAY_0700)
    expect(run.jobs.filter((j) => j.material === 'Y')).toHaveLength(1)
    expect(run.optimisation?.localSearch).toMatchObject({ evaluations: 0, lotSplits: [] })
  })

  it('does not split below the Min. lot', () => {
    const base = plant()
    const run = computePlan(
      { ...base, products: base.products.map((p) => (p.code === 'Y' ? { ...p, minLotQty: 6000 } : p)) },
      MONDAY_0700,
    )
    // Parçalar 3000 < Min. lot 6000: bölünemez, Z geç kalır ve raporlanır.
    expect(run.jobs.filter((j) => j.material === 'Y')).toHaveLength(1)
    expect(run.lateItems?.map((l) => l.material)).toEqual(['Z'])
  })
})

describe('splitLot', () => {
  const product = { code: 'Y', moldCavities: 1, spm: 10, grossWeight: 1, coilWeight: 3000 }
  const entry = (qty: number, over: Partial<DemandEntry> = {}): DemandEntry => ({
    material: 'Y',
    qty,
    dueDate: '2026-09-14',
    earliestDate: '2026-09-14',
    bucketLabel: 'W38',
    phase: 'fill',
    urgency: 0,
    daysOfCover: 0,
    ...over,
  })

  it('splits on whole coils and keeps the total', () => {
    const parts = splitLot(entry(9000), product, 3)!
    expect(parts.map((p) => p.qty)).toEqual([3000, 3000, 3000])
    expect(parts.map((p) => p.bucketLabel)).toEqual(['W38 (1/3)', 'W38 (2/3)', 'W38 (3/3)'])
    expect(splitLot(entry(15000), product, 2)!.map((p) => p.qty)).toEqual([9000, 6000])
  })

  it('puts a remainder that is not a whole coil on the last part', () => {
    expect(splitLot(entry(6500), product, 2)!.map((p) => p.qty)).toEqual([3000, 3500])
  })

  it('need mode: the first part covers what is needed first, rounded up to whole coils', () => {
    const lot = entry(30000, { checkpoints: [{ date: '2026-09-15', fraction: 0.4 }], needFraction: 0.4 })
    // 0,4 × 10 rulo = 4 rulo → 12.000 + 18.000.
    expect(splitLot(lot, product, 2, 'need')!.map((p) => p.qty)).toEqual([12000, 18000])
  })

  it('shares the need between the parts: the second part owes only what the first does not cover', () => {
    const lot = entry(6000, { checkpoints: [{ date: '2026-09-15', fraction: 0.5 }], needFraction: 0.5 })
    const [a, b] = splitLot(lot, product, 2)!
    expect(a.checkpoints?.[0].fraction).toBeCloseTo(1)
    expect(a.noStockout).toBeFalsy()
    expect(b.checkpoints).toEqual([])
    expect(b.noStockout).toBe(true)
  })

  it('refuses when there are not enough coils or a part falls below the Min. lot', () => {
    expect(splitLot(entry(3000), product, 2)).toBeNull()
    expect(splitLot(entry(6000), { ...product, minLotQty: 6000 }, 2)).toBeNull()
    expect(splitLot(entry(6000), undefined, 2)).toBeNull()
    expect(splitLot(entry(6000), product, 1)).toBeNull()
  })
})
