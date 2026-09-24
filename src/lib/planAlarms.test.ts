import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'

// Salı 15 Eylül 2026, 10:00 Romanya.
const NOW = Date.UTC(2026, 8, 15, 7, 0)

function plant(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    products: [
      { code: 'A', moldCavities: 1, spm: 20, setupMinutes: 30, mainMachine: '104' },
      { code: 'B', moldCavities: 1, spm: 20, setupMinutes: 30, mainMachine: '104' },
      {
        code: 'C',
        moldCavities: 1,
        spm: 20,
        setupMinutes: 30,
        mainMachine: '104',
        altMachine1: '105',
        flexiblePress: true,
      },
    ],
    weeklyDemand: [],
    dailyDemand: [],
    stock: [],
    locations: [],
    presses: [
      { name: '104', hall: 'H1' },
      { name: '105', hall: 'H2' },
    ],
    templates: [
      { press: '104', workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 },
      { press: '105', workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 },
    ],
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
    machineProblems: [],
    truncatedInputs: [],
    ...overrides,
  }
}

const daily = (material: string, date: string, qty: number) => ({
  material,
  periods: [{ label: date, qty: -qty }],
})

describe('die alarms', () => {
  it('flags a die that is ready after the customer needs the parts', () => {
    // Kalıp yarından sonra (17 Eylül) 10:00'da hazır, ama yarın (16 Eylül)
    // 1000 adet gitmeli.
    const run = computePlan(
      plant({
        dailyDemand: [daily('A', '2026-09-16', 1000)],
        readiness: [{ material: 'A', ready: false, readyDate: '2026-09-17', readyMinute: 600 }],
      }),
      NOW,
    )
    const alarm = run.alarms.dies.find((d) => d.material === 'A')!
    expect(alarm.critical).toBe(true)
    expect(alarm.stockOut).toBe('2026-09-16')
    expect(alarm.neededBefore).toBe(1000)
    expect(alarm.label).toContain('2026-09-17 10:00')
    // Plan kalıbı 17 Eylül 10:00'dan önce kullanmıyor (07:00 + 180 dk).
    const job = run.jobs.find((j) => j.material === 'A')!
    expect(job.date).toBe('2026-09-17')
    expect(job.setupStartMinute).toBeGreaterThanOrEqual(180)
    expect(run.audit.ok).toBe(true)
  })

  it('only informs when the die is ready before it is needed', () => {
    const run = computePlan(
      plant({
        dailyDemand: [daily('A', '2026-09-24', 1000)],
        readiness: [{ material: 'A', ready: false, readyDate: '2026-09-17', readyMinute: 600 }],
      }),
      NOW,
    )
    const alarm = run.alarms.dies.find((d) => d.material === 'A')!
    expect(alarm.critical).toBe(false)
    expect(alarm.explanation).toContain('after the mould is ready')
  })

  it('treats a die with no ready date as critical when there is demand', () => {
    const run = computePlan(
      plant({
        dailyDemand: [daily('A', '2026-09-22', 500)],
        readiness: [{ material: 'A', ready: false, reason: 'crack in insert' }],
      }),
      NOW,
    )
    const alarm = run.alarms.dies.find((d) => d.material === 'A')!
    expect(alarm.critical).toBe(true)
    expect(run.unplanned.find((u) => u.material === 'A')?.reason).toBe(
      'Mould held: not ready and no ready date',
    )
  })

  it('keeps a die with no date and no demand in the info list', () => {
    const run = computePlan(plant({ readiness: [{ material: 'B', ready: false }] }), NOW)
    expect(run.alarms.dies).toEqual([expect.objectContaining({ material: 'B', critical: false })])
  })
})

describe('machine alarms and breakdowns', () => {
  const breakdown = (over: Partial<NonNullable<PlanInputs['machineProblems']>[number]> = {}) => ({
    press: '104',
    problemType: 'Hydraulic',
    occurredAt: '2026-09-15',
    occurredMinute: 480,
    stopsPress: true,
    status: 'open',
    ...over,
  })

  it('a stopped press with no expected time blocks its parts and is critical', () => {
    const run = computePlan(
      plant({
        dailyDemand: [daily('B', '2026-09-16', 500), daily('C', '2026-09-16', 500)],
        machineProblems: [breakdown()],
      }),
      NOW,
    )
    // B yalnız 104'te yapılabilir: plana alınamaz. C esnek: 105'e gider.
    expect(run.jobs.some((j) => j.press === '104')).toBe(false)
    expect(run.jobs.find((j) => j.material === 'C')?.press).toBe('105')
    const alarm = run.alarms.machines[0]
    expect(alarm.critical).toBe(true)
    expect(alarm.affected.map((a) => a.material)).toEqual(['B'])
    expect(run.audit.ok).toBe(true)
  })

  it('a press back before it is needed only informs', () => {
    const run = computePlan(
      plant({
        dailyDemand: [daily('B', '2026-09-22', 500)],
        machineProblems: [breakdown({ expectedUpDate: '2026-09-16', expectedUpMinute: 720 })],
      }),
      NOW,
    )
    const job = run.jobs.find((j) => j.material === 'B')!
    // 16 Eylül 12:00'den önce 104'te iş yok.
    expect(job.date >= '2026-09-16').toBe(true)
    if (job.date === '2026-09-16') expect(job.setupStartMinute).toBeGreaterThanOrEqual(300)
    expect(run.alarms.machines[0]).toMatchObject({ press: '104', critical: false })
    expect(run.audit.ok).toBe(true)
  })

  it('a fault that does not stop the press is informational and does not block it', () => {
    const run = computePlan(
      plant({
        dailyDemand: [daily('B', '2026-09-16', 500)],
        machineProblems: [breakdown({ stopsPress: false })],
      }),
      NOW,
    )
    expect(run.jobs.find((j) => j.material === 'B')?.press).toBe('104')
    expect(run.alarms.machines[0]).toMatchObject({ kind: 'fault-running', critical: false })
  })
})
