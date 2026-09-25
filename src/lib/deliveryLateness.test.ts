import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

// Tek pres, günde tek vardiya (07:00–15:00). Teslim saati 08:00.
function plant(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    products: [
      { code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 6000, mainMachine: '104' },
      { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
    ],
    weeklyDemand: [{ material: 'Z', overdue: -200, periods: [] }],
    stock: [],
    locations: [],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 0 },
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
    ...overrides,
  }
}

describe('lateness is judged at 08:00 on the need day', () => {
  it('backlog is due the next working day at 08:00, so a same-day job is on time', () => {
    const run = computePlan(plant(), MONDAY_0700)
    const z = run.jobs.find((j) => j.material === 'Z')!
    expect(z.late).toBe(false)
    expect(z.deadlineDate).toBe('2026-09-15')
    expect(z.deadlineLabel).toContain('08:00')
    expect(run.lateItems).toEqual([])
  })

  it('counts only the needed quantity: a long coil lot is on time when the need is ready', () => {
    // 100 adet bakiye, rulo 6000 adet (600 dk) — lot salı sabahına taşar ama
    // gereken 100 adet pazartesi hazır.
    const run = computePlan(
      plant({ weeklyDemand: [{ material: 'Y', overdue: -100, periods: [] }] }),
      MONDAY_0700,
    )
    const y = run.jobs.find((j) => j.material === 'Y')!
    expect(y.quantity).toBe(6000)
    expect(y.endDate).toBe('2026-09-15')
    expect(y.readyDate).toBe('2026-09-14')
    expect(y.late).toBe(false)
    expect(run.lateItems).toEqual([])
  })

  it('reports a late material once, with hours late and a suggestion', () => {
    // Y elle öne alınmış, rulosu salıya taşar; Z salı 08:00'e yetişmez.
    const run = computePlan(
      plant({
        weeklyDemand: [
          { material: 'Y', overdue: -100, periods: [] },
          { material: 'Z', overdue: -200, periods: [] },
        ],
        overrides: [{ material: 'Y', kind: 'priority' }],
      }),
      MONDAY_0700,
    )
    expect(run.jobs.find((j) => j.material === 'Z')!.late).toBe(true)
    expect(run.lateItems).toHaveLength(1)
    const item = run.lateItems![0]
    expect(item.material).toBe('Z')
    expect(item.deadline).toContain('08:00')
    expect(item.neededQuantity).toBe(200)
    expect(item.lateHours).toBeGreaterThan(0)
    expect(item.suggestion).toContain('104')
  })
})

describe('stock counts only in 2009 and 1009', () => {
  it('ignores stock in 2010', () => {
    const run = computePlan(
      plant({ stock: [{ material: 'Z', storageLocation: '2010', unrestricted: 500 }] }),
      MONDAY_0700,
    )
    expect(run.jobs.some((j) => j.material === 'Z')).toBe(true)
  })

  it('counts stock in 2009', () => {
    const run = computePlan(
      plant({ stock: [{ material: 'Z', storageLocation: '2009', unrestricted: 500 }] }),
      MONDAY_0700,
    )
    expect(run.jobs.some((j) => j.material === 'Z')).toBe(false)
  })
})

describe('scenario search', () => {
  it('stops at the scenario limit and reports the level reached', () => {
    const base = plant()
    const run = computePlan(
      { ...base, settings: { ...base.settings, utilisationTarget: 100, maxScenarios: 3 } },
      MONDAY_0700,
    )
    const opt = run.optimisation!
    expect(opt.target).toBe(100)
    expect(opt.tried).toBeLessThanOrEqual(3)
    expect(['limit', 'noImprovement']).toContain(opt.stoppedBecause)
    expect(opt.achieved).toBeLessThan(100)
    expect(opt.scenarios.some((s) => s.label === opt.chosen)).toBe(true)
    expect(opt.perPress.map((p) => p.press)).toEqual(['104'])
  })

  it('stops as soon as the target is reached', () => {
    const base = plant()
    const run = computePlan(
      { ...base, settings: { ...base.settings, utilisationTarget: 1 } },
      MONDAY_0700,
    )
    expect(run.optimisation!.stoppedBecause).toBe('target')
    expect(run.optimisation!.tried).toBe(1)
  })
})
