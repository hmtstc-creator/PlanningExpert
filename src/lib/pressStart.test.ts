import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs, type SnapshotJob } from './planPipeline'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

function plant(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    products: [
      { code: 'A', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      { code: 'B', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
    ],
    weeklyDemand: [{ material: 'B', overdue: -300, periods: [] }],
    stock: [],
    locations: [],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { timeZone: 'Europe/Bucharest', shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 1, maxScenarios: 2, frozenDays: 1 },
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

// Onaylı planda bugün 07:00–09:00 A işi (dondurulmuş gün).
const approvedA: SnapshotJob = {
  material: 'A',
  press: '104',
  hall: 'H1',
  date: '2026-09-14',
  endDate: '2026-09-14',
  phase: 'fill',
  quantity: 900,
  shots: 900,
  coilsNeeded: 0,
  setupStartMinute: 0,
  endMinute: 120,
  segments: [
    { kind: 'setup', date: '2026-09-14', start: 0, end: 30 },
    { kind: 'run', date: '2026-09-14', start: 30, end: 120 },
  ],
  reason: '',
}
const snapshot = { createdAt: MONDAY_0700 - 86_400_000, jobs: [approvedA] }

// Plan içindeki bağımsız kontrol, planlamacının müdahalesinden sonraki onaylı
// planı görür (serbest bırakılan ve kaydırılan işler).
const noRuleBroken = (_inputs: PlanInputs, run: ReturnType<typeof computePlan>) =>
  (run.validation?.rules ?? [{ id: 'validator-missing', broken: 1, examples: [''] }])
    .filter((r) => r.broken > 0)
    .map((r) => `${r.id}: ${r.examples[0]}`)

describe('plan start per press', () => {
  it('a held press takes no new work before its start', () => {
    const inputs = plant({ pressStarts: [{ press: '104', fromDate: '2026-09-15', fromMinute: 600, reason: 'No operator' }] })
    const run = computePlan(inputs, MONDAY_0700)
    const b = run.jobs.find((j) => j.material === 'B')!
    // Salı 10:00 = üretim günü 15'i, net 180. dakika.
    expect(b.date === '2026-09-15' ? b.setupStartMinute >= 180 : b.date > '2026-09-15').toBe(true)
    expect(run.maintenance.some((m) => m.label.startsWith('Held until 2026-09-15 10:00: No operator'))).toBe(true)
    expect(noRuleBroken(inputs, run)).toEqual([])
  })

  it('approved jobs before the start are released and planned again after it', () => {
    const inputs = plant({
      latestSnapshot: snapshot,
      pressStarts: [{ press: '104', fromDate: '2026-09-14', fromMinute: 720, reason: 'No raw material' }],
    })
    const run = computePlan(inputs, MONDAY_0700)
    expect(run.jobs.some((j) => j.frozen)).toBe(false)
    expect(noRuleBroken(inputs, run)).toEqual([])
  })

  it('a closed period (start – end) closes only that window', () => {
    // Pzt 07:30–10:00 kapalı: 60 dk'lık iş 07:00–07:30'a sığmaz, 10:00'dan (net 180) sonra başlar.
    const inside = plant({ pressStarts: [{ press: '104', holdFromDate: '2026-09-14', holdFromMinute: 450, fromDate: '2026-09-14', fromMinute: 600, reason: 'No operator' }] })
    const run = computePlan(inside, MONDAY_0700)
    const b = run.jobs.find((j) => j.material === 'B')!
    expect(b.date === '2026-09-14' ? b.setupStartMinute >= 180 : b.date > '2026-09-14').toBe(true)
    expect(run.maintenance.some((m) => m.label.startsWith('Held 2026-09-14 07:30 – 2026-09-14 10:00: No operator'))).toBe(true)
    expect(noRuleBroken(inside, run)).toEqual([])
    // Pzt 12:00–14:00 kapalı: iş sabah 07:00'de başlar, aralıktan etkilenmez.
    const later = plant({ pressStarts: [{ press: '104', holdFromDate: '2026-09-14', holdFromMinute: 720, fromDate: '2026-09-14', fromMinute: 840 }] })
    const run2 = computePlan(later, MONDAY_0700)
    const b2 = run2.jobs.find((j) => j.material === 'B')!
    expect([b2.date, b2.setupStartMinute]).toEqual(['2026-09-14', 0])
  })

  it('production runs up to a planned stop, finishes the cut coil after it, the rest is a new lot', () => {
    // C: 1.000 adet/rulo (1 kg parça, 1.000 kg rulo), 10 vuruş/dk → rulo 100 dk.
    // Lot 3 rulo = 3.000. Pzt 09:00–10:00 duruş (net 120–180).
    // Setup 07:00–07:30, 1. rulo 07:30–09:00 (90 dk) → duruş → 10:00–10:10 rulo biter.
    // İş 1 rulo (1.000) ile biter; kalan 2.000 yeni parti, kalıp takılı → setup'sız 10:10'da.
    const inputs = plant({
      products: [{ code: 'C', moldCavities: 1, spm: 10, setupMinutes: 30, coilSetupMinutes: 10, grossWeight: 1, coilWeight: 1000, mainMachine: '104' }],
      weeklyDemand: [{ material: 'C', overdue: -3000, periods: [] }],
      pressStarts: [{ press: '104', holdFromDate: '2026-09-14', holdFromMinute: 540, fromDate: '2026-09-14', fromMinute: 600, reason: 'No operator' }],
    })
    const run = computePlan(inputs, MONDAY_0700)
    const jobs = run.jobs.filter((j) => j.material === 'C').sort((a, b) => a.setupStartMinute - b.setupStartMinute)
    expect(jobs.map((j) => j.quantity)).toEqual([1000, 2000])
    const [head, rest] = jobs
    expect(head.segments.map((s) => [s.kind, s.start, s.end])).toEqual([
      ['setup', 0, 30],
      ['run', 30, 120],
      ['run', 180, 190],
    ])
    expect(rest.setupMinutes).toBe(0)
    expect([rest.date, rest.segments[0].start]).toEqual(['2026-09-14', 190])
    expect(noRuleBroken(inputs, run)).toEqual([])
  })

  it('a breakdown with an expected end is bridged the same way', () => {
    // Aynı C lotu; arıza Pzt 09:00, beklenen devreye giriş 10:00.
    const inputs = plant({
      products: [{ code: 'C', moldCavities: 1, spm: 10, setupMinutes: 30, coilSetupMinutes: 10, grossWeight: 1, coilWeight: 1000, mainMachine: '104' }],
      weeklyDemand: [{ material: 'C', overdue: -3000, periods: [] }],
      machineProblems: [{ press: '104', problemType: 'Hydraulic', occurredAt: '2026-09-14', occurredMinute: 540, stopsPress: true, expectedUpDate: '2026-09-14', expectedUpMinute: 600, status: 'open' }],
    })
    const run = computePlan(inputs, MONDAY_0700)
    const jobs = run.jobs.filter((j) => j.material === 'C').sort((a, b) => a.setupStartMinute - b.setupStartMinute)
    expect(jobs.map((j) => j.quantity)).toEqual([1000, 2000])
    expect(jobs[0].segments.map((s) => [s.kind, s.start, s.end])).toEqual([
      ['setup', 0, 30],
      ['run', 30, 120],
      ['run', 180, 190],
    ])
    expect(noRuleBroken(inputs, run)).toEqual([])
  })

  it('a planned stop right after the setup is not bridged: the job starts after it', () => {
    // Setup 07:00–07:30, duruş 07:30–10:00: ilk vuruş yok → iş 10:00'dan sonra.
    const inputs = plant({ pressStarts: [{ press: '104', holdFromDate: '2026-09-14', holdFromMinute: 450, fromDate: '2026-09-14', fromMinute: 600 }] })
    const b = computePlan(inputs, MONDAY_0700).jobs.find((j) => j.material === 'B')!
    expect(b.date === '2026-09-14' ? b.setupStartMinute >= 180 : b.date > '2026-09-14').toBe(true)
  })

  it('a start in the past changes nothing', () => {
    const run = computePlan(plant({ pressStarts: [{ press: '104', fromDate: '2026-09-10', fromMinute: 420 }] }), MONDAY_0700)
    expect(run.maintenance).toEqual([])
  })
})

describe('line behind / ahead of the approved plan', () => {
  it('+3 h moves the approved jobs 3 hours later and closes the first 3 hours', () => {
    const inputs = plant({ latestSnapshot: snapshot, pressStarts: [{ press: '104', delayMinutes: 180 }] })
    const run = computePlan(inputs, MONDAY_0700)
    const a = run.jobs.find((j) => j.frozen && j.material === 'A')!
    expect(a.segments[0].start).toBe(180)
    expect(run.maintenance.some((m) => m.label === 'Behind plan: +3 h' && m.start === 0 && m.end === 180)).toBe(true)
    const b = run.jobs.find((j) => j.material === 'B' && !j.frozen)!
    expect(b.date > '2026-09-14' || b.setupStartMinute >= 300).toBe(true)
    expect(noRuleBroken(inputs, run)).toEqual([])
  })

  it('ahead cannot move work before now', () => {
    const run = computePlan(plant({ latestSnapshot: snapshot, pressStarts: [{ press: '104', delayMinutes: -120 }] }), MONDAY_0700)
    const a = run.jobs.find((j) => j.frozen && j.material === 'A')!
    expect(a.segments[0].start).toBe(0)
  })
})
