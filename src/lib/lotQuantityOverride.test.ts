import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'
import { validatePlan } from './planValidator'

// Planlamacı grafikte işe tıklayıp lot adedini değiştirir (2026-10-19): kural
// Plan overrides'a `quantity` olarak yazılır, plan yeniden hesaplanınca o lot
// verilen adetle (tam ruloya yuvarlanmış) çıkar, fark sonraki lotlara akar.
const NOW = Date.UTC(2026, 8, 21, 5, 0)

function plant(overrides: PlanInputs['overrides'] = []): PlanInputs {
  const presses = [{ name: 'P1', hall: 'H1' }]
  return {
    products: [
      { code: 'A', mainMachine: 'P1', spm: 30, moldCavities: 1, setupMinutes: 30, grossWeight: 1, coilWeight: 1000 },
    ],
    weeklyDemand: [
      {
        material: 'A',
        overdue: 0,
        periods: [
          { label: 'W39', qty: 2000 },
          { label: 'W40', qty: 2000 },
          { label: 'W41', qty: 2000 },
        ],
      },
    ],
    stock: [],
    locations: [],
    presses,
    templates: presses.map((p) => ({ press: p.name, workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 })),
    settings: { timeZone: 'Europe/Bucharest', shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 4 },
    workCalendar: null,
    officialHolidays: [],
    latestSnapshot: null,
    plannedStops: [],
    overrides,
    moldMaintenance: [],
    readiness: [],
    pressMaintenance: [],
    alarms: [],
    truncatedInputs: [],
  }
}

const lotQty = (run: ReturnType<typeof computePlan>, bucket: string) =>
  run.jobs.filter((j) => j.material === 'A' && j.bucketLabel === bucket).reduce((s, j) => s + j.quantity, 0)

describe('lot quantity set by hand', () => {
  const base = computePlan(plant(), NOW)
  const total = (run: ReturnType<typeof computePlan>) =>
    run.jobs.filter((j) => j.material === 'A').reduce((s, j) => s + j.quantity, 0)

  it('the engine plan has a lot per week', () => {
    expect(lotQty(base, 'W39')).toBe(2000)
    expect(lotQty(base, 'W40')).toBe(2000)
  })

  it('a larger lot is rounded up to whole coils and the later lots shrink', () => {
    const run = computePlan(plant([{ material: 'A', kind: 'quantity', bucket: 'W39', qty: 3500 }]), NOW)
    expect(lotQty(run, 'W39')).toBe(4000)
    expect(lotQty(run, 'W40')).toBe(0)
    expect(total(run)).toBe(total(base))
    for (const j of run.jobs) expect(j.quantity % 1000).toBe(0)
  })

  it('a smaller lot moves the rest to the next lot; plan check still holds', () => {
    const inputs = plant([{ material: 'A', kind: 'quantity', bucket: 'W39', qty: 1000 }])
    const run = computePlan(inputs, NOW)
    expect(lotQty(run, 'W39')).toBe(1000)
    expect(lotQty(run, 'W40')).toBe(3000)
    expect(total(run)).toBe(total(base))
    const check = validatePlan(inputs, run, NOW)
    expect(check.rules.find((r) => r.id === 'conservation')?.broken).toBe(0)
  })

  it('a rule for a lot that no longer exists changes nothing', () => {
    const run = computePlan(plant([{ material: 'A', kind: 'quantity', bucket: 'W30', qty: 9000 }]), NOW)
    expect(run.jobs.map((j) => [j.bucketLabel, j.quantity])).toEqual(base.jobs.map((j) => [j.bucketLabel, j.quantity]))
  })
})
