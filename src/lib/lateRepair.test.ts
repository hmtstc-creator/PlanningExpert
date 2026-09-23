import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

// Tek pres, günde tek vardiya (480 dk). Y ve Z ikisi de bugün teslim
// (bakiye) ve yalnız 104'te yapılabiliyor. Y'nin rulosu 6000 parça:
// 100'lük bakiye için 600 dakikalık rulo basılırsa Z ertesi güne kalır —
// müşteri durur.
function plant(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    products: [
      { code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 6000, mainMachine: '104' },
      { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
    ],
    weeklyDemand: [
      { material: 'Y', overdue: -100, periods: [] },
      { material: 'Z', overdue: -200, periods: [] },
    ],
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

describe('late jobs are re-planned, not left late', () => {
  it('moves the late lot forward', () => {
    const run = computePlan(plant(), MONDAY_0700)
    expect(run.lateRepair.lateBefore).toBe(1)
    expect(run.lateRepair.lateAfter).toBe(0)
    expect(run.lateRepair.boosted).toEqual(['Z'])
    expect(run.jobs.every((j) => !j.late)).toBe(true)
    expect(run.jobs.find((j) => j.material === 'Z')?.reason).toContain('moved forward')
  })

  it('cuts a surplus coil when moving forward is not enough', () => {
    // Y elle öne alınmış: Z onun önüne geçemez. Tek çare Y'nin 6000'lik
    // rulosunu ihtiyaç kadara (100) indirmek.
    const run = computePlan(plant({ overrides: [{ material: 'Y', kind: 'priority' }] }), MONDAY_0700)
    expect(run.lateRepair.lateBefore).toBe(1)
    expect(run.lateRepair.lateAfter).toBe(0)
    expect(run.lateRepair.trimmed).toContain('Y')
    const y = run.jobs.find((j) => j.material === 'Y')!
    expect(y.quantity).toBe(100)
    expect(y.reason).toContain('exact quantity')
    expect(run.jobs.every((j) => !j.late)).toBe(true)
  })

  it('keeps whole coils when nothing is late', () => {
    const run = computePlan(
      plant({ weeklyDemand: [{ material: 'Y', overdue: -100, periods: [] }] }),
      MONDAY_0700,
    )
    expect(run.lateRepair.rounds).toBe(0)
    expect(run.jobs[0].quantity).toBe(6000)
  })
})
