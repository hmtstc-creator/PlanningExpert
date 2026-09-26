import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'
import { validatePlan } from './planValidator'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

// Tek pres, tek vardiya 07:00–15:00, 07:15'te 15 dk'lık çay molası.
// Setup 30 dk: operatörler endirekt, molaya setup bitince çıkarlar.
function plant(kind: string): PlanInputs {
  return {
    products: [{ code: 'A', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' }],
    weeklyDemand: [{ material: 'A', overdue: -600, periods: [] }],
    stock: [],
    locations: [],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 1, maxScenarios: 2 },
    workCalendar: null,
    officialHolidays: [],
    latestSnapshot: null,
    plannedStops: [{ shiftIndex: 1, name: 'Stop', kind, startMinute: 435, durationMinutes: 15 }],
    overrides: [],
    moldMaintenance: [],
    readiness: [],
    pressMaintenance: [],
    alarms: [],
    truncatedInputs: [],
  }
}

const setupNet = (run: ReturnType<typeof computePlan>) =>
  run.jobs[0].segments.filter((s) => s.kind === 'setup').reduce((a, s) => a + s.end - s.start, 0)
const firstRun = (run: ReturnType<typeof computePlan>) => run.jobs[0].segments.find((s) => s.kind === 'run')!.start

describe('setup runs on through tea and meal breaks', () => {
  it('a 30 min setup with a tea break after 15 min ends with the break', () => {
    const run = computePlan(plant('tea'), MONDAY_0700)
    // Net eksende 15 dk (07:00–07:15), çay 07:15–07:30 setup'ın içinde;
    // üretim 07:30'da başlar.
    expect(setupNet(run)).toBe(15)
    expect(firstRun(run)).toBe(15)
    expect(run.jobs[0].setupMinutes).toBe(30)
    expect(run.jobs[0].reason).toContain('through the tea/meal break')
    const v = validatePlan(plant('tea'), run, MONDAY_0700)
    expect(v.rules.filter((r) => r.broken > 0).map((r) => r.id)).toEqual([])
  })

  it('the same holds for a meal break', () => {
    expect(setupNet(computePlan(plant('meal'), MONDAY_0700))).toBe(15)
  })

  it('a shift handover still stops the setup', () => {
    const run = computePlan(plant('handover'), MONDAY_0700)
    expect(setupNet(run)).toBe(30)
    expect(firstRun(run)).toBe(30)
  })
})
