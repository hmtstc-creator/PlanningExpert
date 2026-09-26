import { expect, it } from 'vitest'
import { computePlan } from './planPipeline'
it('backlog: two setups overlap in one hall and both independent checks accept it', () => {
  const products = ['A', 'B', 'C'].map((c, i) => ({ code: c, moldCavities: 1, spm: 10, setupMinutes: 60, mainMachine: `10${i + 4}`, coilWeight: 1, grossWeight: 0.5 }))
  const run = computePlan({
    products,
    weeklyDemand: products.map((p) => ({ material: p.code, overdue: -600, periods: [{ label: 'W38', qty: -100 }] })),
    stock: [], locations: [],
    presses: ['104', '105', '106'].map((name) => ({ name, hall: 'H1' })),
    templates: ['104', '105', '106'].map((press) => ({ press, workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 })),
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, maxScenarios: 2, maxSetupsPlantWide: 2, maxSetupsPlantWideNormal: 1, concurrentSetupsPerHall: 1 },
    workCalendar: null, officialHolidays: [], latestSnapshot: null, plannedStops: [], overrides: [], moldMaintenance: [], readiness: [], pressMaintenance: [], alarms: [], truncatedInputs: [],
  } as never, Date.UTC(2026, 8, 14, 4, 0))
  const setups = run.jobs.flatMap((j) => (j.segments ?? []).filter((s) => s.kind === 'setup').map((s) => `${j.press} ${s.date} ${s.start}-${s.end}`))
  // 104 ve 105 aynı anda setup yapar (tek hol, fabrika acil sınırı 2), 106 bekler.
  expect(setups.filter((x) => x.endsWith(' 0-60'))).toHaveLength(2)
  const v = run.validation as { rules?: { id: string; broken: number; examples?: string[] }[] } | undefined
  const a = (run as never as { audit: { rules: { id: string; failed?: number; broken?: number; examples?: string[] }[] } }).audit
  expect(a.rules.every((r) => (r as { violationCount?: number }).violationCount === 0)).toBe(true)
  expect(v?.rules?.filter((r) => r.broken > 0).length ?? 0).toBe(0)
})
