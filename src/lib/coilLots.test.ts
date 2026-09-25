import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'

// Kullanıcının bulduğu hata: rulo 3000 parça verirken 450 parçalık iş
// planlanıyordu. Yük altında (geç iş varken) bile hiçbir rulolu iş tam
// rulonun altına inmemeli; eş ürün çifti tek iş olmalı.
const NOW = Date.UTC(2026, 8, 21, 5, 0)

function loadedPlant(): PlanInputs {
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const presses = [
    { name: 'P1', hall: 'H1' },
    { name: 'P2', hall: 'H1' },
    { name: 'P3', hall: 'H2' },
  ]
  const products: PlanInputs['products'] = []
  const weeklyDemand: PlanInputs['weeklyDemand'] = []
  for (let i = 0; i < 24; i++) {
    products.push({
      code: `C${i}`,
      mainMachine: presses[i % 3].name,
      spm: 12,
      moldCavities: 1,
      setupMinutes: 60,
      coilSetupMinutes: 15,
      grossWeight: 1,
      coilWeight: 3000,
      performanceFactor: 0.6,
    })
    const week = Math.round(400 + rnd() * 1800)
    weeklyDemand.push({
      material: `C${i}`,
      overdue: i % 5 === 0 ? 900 : 0,
      periods: Array.from({ length: 6 }, (_, w) => ({ label: `W${39 + w}`, qty: week })),
    })
  }
  products.push(
    { code: 'L', coProduct: 'R', mainMachine: 'P1', spm: 12, moldCavities: 1, setupMinutes: 60, grossWeight: 1, coilWeight: 3000 },
    { code: 'R', mainMachine: 'P1', spm: 12, moldCavities: 1, setupMinutes: 60, grossWeight: 1, coilWeight: 3000 },
  )
  weeklyDemand.push(
    { material: 'L', overdue: 0, periods: [{ label: 'W39', qty: 1000 }] },
    { material: 'R', overdue: 0, periods: [{ label: 'W39', qty: 1500 }] },
  )
  return {
    products,
    weeklyDemand,
    stock: [],
    locations: [],
    presses,
    templates: presses.map((p) => ({ press: p.name, workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 })),
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 4 },
    workCalendar: null,
    officialHolidays: [],
    latestSnapshot: null,
    plannedStops: [],
    overrides: [],
    moldMaintenance: [],
    readiness: [],
    pressMaintenance: [],
    alarms: [],
    truncatedInputs: [],
  }
}

describe('coil lots under load', () => {
  const run = computePlan(loadedPlant(), NOW)

  it('never plans a coil-fed job below a whole coil, even with late jobs', () => {
    expect(run.jobs.some((j) => j.late)).toBe(true)
    for (const job of run.jobs) expect(job.quantity % 3000).toBe(0)
    const rule = run.audit.rules.find((r) => r.id === 'whole-coils')!
    expect(rule.checked).toBeGreaterThan(0)
    expect(rule.violationCount).toBe(0)
  })

  it('plans a co-product pair as one job on one set of strokes', () => {
    const pair = run.jobs.filter((j) => j.material === 'L' || j.material === 'R')
    expect(pair).toHaveLength(1)
    expect(pair[0].material).toBe('L')
    expect(pair[0].coProductQuantity).toBe(3000)
    expect(pair[0].reason).toContain('co-product R')
  })

  it('backlog and this week’s need of a part share one coil and one setup', () => {
    const c0 = run.jobs.filter((j) => j.material === 'C0' && j.date <= '2026-09-25')
    expect(c0).toHaveLength(1)
  })
})
