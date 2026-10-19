import { describe, expect, it } from 'vitest'

import { computePlan, type ApprovedJobLock, type PlanInputs, type PlanRun } from './planPipeline'

// Planlamacı grafikte tek bir işi onaylar (2026-10-19): iş kilitlenir, yeniden
// hesapta aynı pres ve aynı saatte kalır; adedi talebi karşılar (iki kez
// planlanmaz); bağımsız doğrulamanın "frozen" kuralı onu onaylı iş sayar.
const NOW = Date.UTC(2026, 8, 21, 5, 0)

function plant(extra: Partial<PlanInputs> = {}): PlanInputs {
  const presses = [{ name: 'P1', hall: 'H1' }, { name: 'P2', hall: 'H1' }]
  return {
    products: [
      { code: 'A', mainMachine: 'P1', altMachine1: 'P2', flexiblePress: true, spm: 30, moldCavities: 1, setupMinutes: 30, grossWeight: 1, coilWeight: 1000 },
      { code: 'B', mainMachine: 'P1', spm: 30, moldCavities: 1, setupMinutes: 30, grossWeight: 1, coilWeight: 1000 },
    ],
    weeklyDemand: [
      { material: 'A', overdue: 0, periods: [{ label: 'W39', qty: 2000 }, { label: 'W40', qty: 2000 }, { label: 'W41', qty: 2000 }] },
      { material: 'B', overdue: 0, periods: [{ label: 'W39', qty: 1000 }, { label: 'W40', qty: 1000 }] },
    ],
    stock: [],
    locations: [],
    presses,
    templates: presses.map((p) => ({ press: p.name, workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 })),
    settings: { timeZone: 'Europe/Bucharest', shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 4, frozenDays: 0 },
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
    ...extra,
  }
}

const lockOf = (run: PlanRun, at: (j: PlanRun['jobs'][number]) => boolean): ApprovedJobLock => {
  const j = run.jobs.filter((x) => !x.frozen).filter(at).sort((a, b) => b.date.localeCompare(a.date))[0]
  return {
    material: j.material,
    press: j.press,
    hall: j.hall,
    date: j.date,
    phase: j.phase,
    quantity: j.quantity,
    shots: j.shots,
    coilsNeeded: j.coilsNeeded,
    setupStartMinute: j.setupStartMinute,
    endMinute: j.endMinute,
    endDate: j.endDate,
    segments: j.segments.map((s) => ({ kind: s.kind, date: s.date, start: s.start, end: s.end })),
    reason: j.reason,
    approvedBy: 'Planner',
    createdAt: NOW,
  }
}

const total = (run: PlanRun, m: string) => run.jobs.filter((j) => j.material === m).reduce((s, j) => s + j.quantity, 0)

describe('approved (locked) job', () => {
  const base = computePlan(plant(), NOW)
  // Dondurma kapalıyken en geç işi kilitle: kilit, dondurulmuş ufuktan bağımsız tutmalı.
  const lock = lockOf(base, (j) => j.material === 'A')
  const run = computePlan(plant({ jobLocks: [lock] }), NOW)
  const kept = run.jobs.find((j) => j.locked)

  it('stays on the same work center at the same time', () => {
    expect(kept).toBeDefined()
    expect([kept!.press, kept!.date, kept!.setupStartMinute, kept!.quantity]).toEqual([
      lock.press,
      lock.date,
      lock.setupStartMinute,
      lock.quantity,
    ])
    expect(kept!.frozen).toBe(true)
    expect(kept!.reason).toContain('Approved job')
  })

  it('covers demand: the part is not planned twice', () => {
    expect(total(run, 'A')).toBe(total(base, 'A'))
    expect(total(run, 'B')).toBe(total(base, 'B'))
  })

  it('passes the independent check (frozen-intact, one job at a time)', () => {
    const rules = run.validation?.rules ?? []
    expect(rules.find((r) => r.id === 'frozen-intact')?.broken).toBe(0)
    expect(rules.find((r) => r.id === 'press-overlap')?.broken).toBe(0)
  })

  it('a lock that is also in the approved plan counts once', () => {
    const snapshot = { createdAt: NOW - 3_600_000, jobs: [lock] }
    const both = computePlan(plant({ latestSnapshot: snapshot, jobLocks: [lock] }), NOW)
    expect(both.jobs.filter((j) => j.locked)).toHaveLength(1)
    expect(total(both, 'A')).toBe(total(base, 'A'))
  })
})
