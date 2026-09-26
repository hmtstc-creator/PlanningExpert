import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs, type SnapshotJob } from './planPipeline'
import { validatePlan } from './planValidator'
import { randomPlant } from './randomPlant.fixture'

// Uzman incelemesinde bulunan hataların testleri. Her biri önce yeniden
// üretildi, sonra düzeltildi.

// Pazartesi 14 Eylül 2026, 07:00 Romanya.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

function plant(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    products: [
      { code: 'A', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 6000, mainMachine: '104' },
      { code: 'B', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
    ],
    weeklyDemand: [],
    stock: [],
    locations: [],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 1, maxScenarios: 4 },
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

describe('backlog is its own lot', () => {
  it('a lot is not labelled backlog when stock already covers the overdue', () => {
    // Bakiye 500, stok 2500 → bakiye karşılandı; bu haftanın ihtiyacı bakiye değildir.
    const run = computePlan(
      plant({
        weeklyDemand: [{ material: 'A', overdue: -500, periods: [{ label: 'W38', qty: -3000 }] }],
        stock: [{ material: 'A', storageLocation: '2009', unrestricted: 2500 }],
      }),
      MONDAY_0700,
    )
    const jobs = run.jobs.filter((j) => j.material === 'A')
    expect(jobs.length).toBeGreaterThan(0)
    expect(jobs.some((j) => j.phase === 'backlog')).toBe(false)
  })

  it('backlog and this week share one coil when the coil covers both', () => {
    // Kullanıcının örneği: bakiye 200 + bu hafta 2000, rulo 6000 → tek iş.
    const run = computePlan(
      plant({ weeklyDemand: [{ material: 'A', overdue: -200, periods: [{ label: 'W38', qty: -2000 }] }] }),
      MONDAY_0700,
    )
    const jobs = run.jobs.filter((j) => j.material === 'A')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].quantity).toBe(6000)
  })
})

describe('mould-limit runs are judged on their own share', () => {
  it('a later run is not late when earlier runs already cover the need', () => {
    // 100 bakiye, min. lot 6000, kalıp limiti 2000 vuruş → 3 parti; ilk parti yeter.
    const run = computePlan(
      plant({
        products: [{ code: 'A', moldCavities: 1, spm: 5, setupMinutes: 30, minLotQty: 6000, maxShots: 2000, mainMachine: '104' }],
        weeklyDemand: [{ material: 'A', overdue: -100, periods: [] }],
      }),
      MONDAY_0700,
    )
    expect(run.jobs.filter((j) => j.material === 'A').length).toBeGreaterThan(1)
    expect(run.jobs.some((j) => j.late)).toBe(false)
    expect(run.lateItems).toEqual([])
  })
})

describe('the plan starts from what is running now', () => {
  it('an approved job still running from yesterday keeps its press', () => {
    // Dün başlayan 6000'lik A işi bugün 09:00'a kadar sürüyor (dondurma kapalı).
    const running: SnapshotJob = {
      material: 'A',
      press: '104',
      hall: 'H1',
      date: '2026-09-11',
      endDate: '2026-09-14',
      phase: 'urgent',
      quantity: 6000,
      shots: 6000,
      coilsNeeded: 1,
      setupStartMinute: 300,
      endMinute: 120,
      segments: [
        { kind: 'setup', date: '2026-09-11', start: 300, end: 330 },
        { kind: 'run', date: '2026-09-11', start: 330, end: 480 },
        { kind: 'run', date: '2026-09-14', start: 0, end: 120 },
      ],
      reason: '',
    }
    const run = computePlan(
      plant({
        weeklyDemand: [{ material: 'B', overdue: -300, periods: [] }],
        latestSnapshot: { createdAt: MONDAY_0700 - 3 * 86_400_000, jobs: [running] },
      }),
      MONDAY_0700,
    )
    const b = run.jobs.find((j) => j.material === 'B' && !j.frozen)!
    // B, A bitmeden (bugün 120. net dakika) başlayamaz.
    expect(b.date > '2026-09-14' || b.setupStartMinute >= 120).toBe(true)
    const v = validatePlan(
      plant({
        weeklyDemand: [{ material: 'B', overdue: -300, periods: [] }],
        latestSnapshot: { createdAt: MONDAY_0700 - 3 * 86_400_000, jobs: [running] },
      }),
      run,
      MONDAY_0700,
    )
    expect(v.rules.find((r) => r.id === 'press-overlap')?.examples ?? []).toEqual([])
  })
})

describe('independent check agrees with the engine on random plants', () => {
  // Salı 16 Eylül 2026 10:00 Romanya.
  const NOW = Date.UTC(2026, 8, 16, 7, 0)
  const HARD_RULES = ['press-overlap', 'mould-twice', 'crane-hall', 'plant-setups', 'eligible-press', 'working-time', 'lot-rules', 'die-change-without-setup', 'conservation']
  for (let seed = 1; seed <= 12; seed++) {
    it(`random plant #${seed}`, () => {
      const inputs = randomPlant(seed)
      const run = computePlan(inputs, NOW)
      const v = validatePlan(inputs, run, NOW)
      // Motorun geç listesi, stoğun saat saat yeniden yürütülmesiyle aynı.
      expect(v.summary.verdicts['engine-missed']).toBe(0)
      expect(v.summary.verdicts['engine-false-late']).toBe(0)
      // Fiziksel kurallar bağımsız olarak da tutuyor.
      const broken = v.rules.filter((r) => HARD_RULES.includes(r.id) && r.broken > 0).map((r) => `${r.id}: ${r.examples[0]}`)
      expect(broken).toEqual([])
      // Planın geç malzemesi, kanıtlanmış alt sınırın altında olamaz.
      expect(v.summary.realStockouts).toBeGreaterThanOrEqual(v.summary.lateLowerBound)
    }, 30_000)
  }
})

describe('breaks inside every shift and overtime weeks', () => {
  // Gerçek fabrikadaki gibi: her vardiyada çay ve yemek, bazı haftalar
  // cumartesi + fazla mesai. Mola bir setup'ı ikiye böler (yine tek setup);
  // gece sonundaki setup ertesi sabah 07:00'deki setup'la karşılaştırılır.
  const NOW = Date.UTC(2026, 8, 16, 7, 0)
  const stops = [
    { shiftIndex: 1, name: 'Tea', kind: 'break', startMinute: 540, durationMinutes: 15 },
    { shiftIndex: 1, name: 'Lunch', kind: 'meal', startMinute: 690, durationMinutes: 30 },
    { shiftIndex: 2, name: 'Tea', kind: 'break', startMinute: 1020, durationMinutes: 15 },
    { shiftIndex: 2, name: 'Meal', kind: 'meal', startMinute: 1170, durationMinutes: 30 },
    { shiftIndex: 3, name: 'Tea', kind: 'break', startMinute: 60, durationMinutes: 15 },
    { shiftIndex: 3, name: 'Meal', kind: 'meal', startMinute: 180, durationMinutes: 30 },
  ]
  for (const seed of [1, 3, 5, 8]) {
    it(`random plant #${seed}: no rule broken`, () => {
      const base = randomPlant(seed)
      const inputs: PlanInputs = {
        ...base,
        plannedStops: stops,
        settings: { ...base.settings, setupGapMinutes: 10, maxScenarios: 20 },
        weekOverrides: base.presses.map((p) => ({
          press: p.name,
          weekStart: '2026-09-14',
          workingDays: 6,
          shiftsPerDay: 3,
        })),
        // Pazar mesaisi (tarihli, tanımla): 07:00'dan 8 saat, molalar düşülür.
        overtimeDefinitions: [{ id: 'full', name: 'Full overtime', startMinute: 420, durationMinutes: 480 }],
        pressOvertime: base.presses.map((p) => ({ press: p.name, date: '2026-09-20', definitionId: 'full' })),
      }
      const run = computePlan(inputs, NOW)
      const v = validatePlan(inputs, run, NOW)
      expect(v.rules.filter((r) => r.broken > 0).map((r) => `${r.id}: ${r.examples[0]}`)).toEqual([])
      expect(run.audit.rules.flatMap((r) => r.violations)).toEqual([])
    }, 60_000)
  }
})
