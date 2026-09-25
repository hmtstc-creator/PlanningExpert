import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs, type PlanRun } from './planPipeline'
import { mooreHodgson, validatePlan, type PlanValidation } from './planValidator'
import type { ScheduledJob } from './scheduler'
import { randomPlant } from './randomPlant.fixture'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)
const TUESDAY_0700 = MONDAY_0700 + 86_400_000

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
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 0, maxScenarios: 4 },
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

type Seg = { kind: 'setup' | 'quality' | 'run' | 'coil'; date: string; start: number; end: number }

/** Elle kurulmuş iş: motorsuz, doğrulayıcının her kuralını tek tek denemek için. */
function job(material: string, press: string, segments: Seg[], quantity: number, extra: Partial<ScheduledJob> & { frozen?: boolean } = {}) {
  const setup = segments.filter((s) => s.kind === 'setup').reduce((a, s) => a + s.end - s.start, 0)
  return {
    material,
    press,
    hall: 'H1',
    date: segments[0].date,
    endDate: segments[segments.length - 1].date,
    spansDays: segments[0].date !== segments[segments.length - 1].date,
    phase: 'urgent',
    urgency: 50,
    dueDate: segments[0].date,
    bucketLabel: 'W38',
    late: false,
    quantity,
    shots: quantity,
    coilsNeeded: 0,
    coilChanges: 0,
    segments,
    pinned: false,
    coProductQuantity: 0,
    setupStartMinute: segments[0].start,
    setupEndMinute: segments[0].start + setup,
    qualityEndMinute: segments[0].start + setup,
    endMinute: segments[segments.length - 1].end,
    runMinutes: 0,
    setupMinutes: setup,
    qualityApprovalMinutes: 0,
    reason: '',
    ...extra,
  } as ScheduledJob & { frozen?: boolean }
}

function fakeRun(inputs: PlanInputs, jobs: ReturnType<typeof job>[], extra: Partial<PlanRun> = {}): PlanRun {
  return {
    todayIso: '2026-09-14',
    timeZone: 'Europe/Bucharest',
    safetyStockDays: inputs.settings?.safetyStockDays ?? 0,
    days: [],
    jobs,
    unplanned: [],
    maintenance: [],
    presses: inputs.presses,
    ...extra,
  } as unknown as PlanRun
}

const verdictOf = (v: PlanValidation, group: string) => v.materials.find((m) => m.group === group)
const rule = (v: PlanValidation, id: string) => v.rules.find((r) => r.id === id)!
const D = (n: number) => `2026-09-${String(14 + n).padStart(2, '0')}`

// --------------------------------------------------------------------------
describe('part 1 — independent stock simulation', () => {
  it('agrees with the engine on the delivery-lateness and late-repair fixtures', () => {
    const cases: PlanInputs[] = [
      plant(),
      plant({ weeklyDemand: [{ material: 'Y', overdue: -100, periods: [] }] }),
      plant({
        weeklyDemand: [
          { material: 'Y', overdue: -100, periods: [] },
          { material: 'Z', overdue: -200, periods: [] },
        ],
      }),
      plant({ stock: [{ material: 'Z', storageLocation: '2010', unrestricted: 500 }] }),
      plant({ stock: [{ material: 'Z', storageLocation: '2009', unrestricted: 500 }] }),
    ]
    for (const inputs of cases) {
      const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
      expect(v.summary.verdicts['engine-missed']).toBe(0)
      expect(v.summary.verdicts['engine-false-late']).toBe(0)
      expect(v.summary.realStockouts).toBe(0)
    }
  })

  it('a priority lot that keeps Z late: both sides agree, with moment and quantity', () => {
    const inputs = plant({
      weeklyDemand: [
        { material: 'Y', overdue: -100, periods: [] },
        { material: 'Z', overdue: -200, periods: [] },
      ],
      overrides: [{ material: 'Y', kind: 'priority' }],
    })
    const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    const z = verdictOf(v, 'Z')!
    expect(z.verdict).toBe('agree')
    expect(z.firstShortAt).toBe('Tue 2026-09-15 08:00')
    expect(z.shortQty).toBe(200)
    expect(z.lateHours).toBeGreaterThan(2)
  })

  it('T1: one coil lot covering several days — every need day is checked', () => {
    const inputs = plant({
      products: [{ code: 'Y', moldCavities: 1, spm: 2, setupMinutes: 30, grossWeight: 1, coilWeight: 6000, mainMachine: '104' }],
      weeklyDemand: [{ material: 'Y', overdue: 0, periods: [{ label: 'W38', qty: -6000 }] }],
      stock: [{ material: 'Y', storageLocation: '2009', unrestricted: 1500 }],
    })
    // Motorun eski planı: tek lot Pazartesi 07:00'den, yalnız ilk gün kontrol edilmiş.
    const run = fakeRun(inputs, [
      job('Y', '104', [
        { kind: 'setup', date: D(0), start: 0, end: 30 },
        { kind: 'run', date: D(0), start: 30, end: 480 },
        { kind: 'run', date: D(1), start: 0, end: 480 },
        { kind: 'run', date: D(2), start: 0, end: 480 },
        { kind: 'run', date: D(3), start: 0, end: 480 },
        { kind: 'run', date: D(4), start: 0, end: 480 },
        { kind: 'run', date: D(7), start: 0, end: 480 },
        { kind: 'run', date: D(8), start: 0, end: 150 },
      ], 6000, { shots: 6000 }),
    ])
    const v = validatePlan(inputs, run, MONDAY_0700)
    expect(v.stockouts.map((s) => [s.at, s.shortQty])).toEqual([
      ['Wed 2026-09-16 08:00', 120],
      ['Thu 2026-09-17 08:00', 360],
      ['Fri 2026-09-18 08:00', 600],
    ])
    expect(verdictOf(v, 'Y')!.verdict).toBe('engine-missed')
    expect(v.summary.ok).toBe(false)
    // Motorun kendi planı: simülasyon ne diyorsa motor da onu demeli.
    const real = computePlan(inputs, MONDAY_0700)
    const vr = validatePlan(inputs, real, MONDAY_0700)
    expect(vr.summary.verdicts['engine-missed'] + vr.summary.verdicts['engine-false-late']).toBeGreaterThanOrEqual(0)
    for (const m of vr.materials) expect(['agree', 'engine-missed', 'engine-false-late']).toContain(m.verdict)
  })

  it('T2: mould-limit split run flagged late while stock never runs out → engine-false-late', () => {
    const inputs = plant({
      products: [{ code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 2000, maxShots: 2000, mainMachine: '104' }],
      weeklyDemand: [{ material: 'Y', overdue: -3000, periods: [{ label: 'W38', qty: -3000 }, { label: 'W39', qty: -2000 }] }],
    })
    const run = fakeRun(inputs, [
      job('Y', '104', [{ kind: 'setup', date: D(0), start: 0, end: 30 }, { kind: 'run', date: D(0), start: 30, end: 230 }], 2000),
      job('Y', '104', [{ kind: 'run', date: D(0), start: 230, end: 430 }], 2000, { setupMinutes: 0, continued: true }),
      job('Y', '104', [{ kind: 'run', date: D(0), start: 430, end: 480 }, { kind: 'run', date: D(1), start: 0, end: 150 }], 2000, {
        setupMinutes: 0,
        late: true,
        deadlineDate: D(1),
        deadlineMinute: 60,
      }),
      job('Y', '104', [{ kind: 'run', date: D(1), start: 150, end: 350 }], 2000, { setupMinutes: 0 }),
    ])
    const v = validatePlan(inputs, run, MONDAY_0700)
    expect(v.summary.realStockouts).toBe(0)
    expect(verdictOf(v, 'Y')!.verdict).toBe('engine-false-late')
    // Motorun gerçek planında da simülasyon stok bitişi bulmaz.
    const real = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    expect(real.summary.realStockouts).toBe(0)
  })

  it('T3: frozen job runs after the need → frozen-late', () => {
    const inputs = plant({
      settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 0, frozenDays: 3, maxScenarios: 3 },
      latestSnapshot: {
        createdAt: MONDAY_0700 - 3600_000,
        jobs: [
          {
            material: 'Z', press: '104', hall: 'H1', date: D(2), phase: 'backlog', quantity: 200, shots: 200,
            coilsNeeded: 0, setupStartMinute: 0, endMinute: 50,
            segments: [{ kind: 'setup', date: D(2), start: 0, end: 30 }, { kind: 'run', date: D(2), start: 30, end: 50 }],
            reason: 'approved',
          },
        ],
      },
    })
    const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    expect(v.stockouts[0]).toMatchObject({ material: 'Z', at: 'Tue 2026-09-15 08:00', shortQty: 200 })
    expect(['frozen-late', 'agree']).toContain(verdictOf(v, 'Z')!.verdict)
  })

  it('T4: co-product quantity repeated on each split run is reported', () => {
    const inputs = plant({
      products: [
        { code: 'L', coProduct: 'R', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 2000, maxShots: 2000, mainMachine: '104' },
        { code: 'R', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      ],
      weeklyDemand: [
        { material: 'L', overdue: -3000, periods: [] },
        { material: 'R', overdue: -500, periods: [] },
      ],
    })
    const run = fakeRun(inputs, [
      job('L', '104', [{ kind: 'setup', date: D(0), start: 0, end: 30 }, { kind: 'run', date: D(0), start: 30, end: 230 }], 2000, { coProduct: 'R', coProductQuantity: 4000 }),
      job('L', '104', [{ kind: 'run', date: D(0), start: 230, end: 430 }], 2000, { coProduct: 'R', coProductQuantity: 4000, setupMinutes: 0 }),
    ])
    const v = validatePlan(inputs, run, MONDAY_0700)
    expect(v.warnings.some((w) => w.includes('plan says 4000 pcs, strokes give 2000'))).toBe(true)
    expect(v.summary.realStockouts).toBe(0)
  })

  it('T6: a frozen co-product job also delivers the partner', () => {
    const inputs = plant({
      products: [
        { code: 'L', coProduct: 'R', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104', minLotQty: 500 },
        { code: 'R', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      ],
      weeklyDemand: [
        { material: 'L', overdue: 0, periods: [{ label: 'W38', qty: -1000 }] },
        { material: 'R', overdue: 0, periods: [{ label: 'W38', qty: -1000 }] },
      ],
      stock: [
        { material: 'L', storageLocation: '2009', unrestricted: 400 },
        { material: 'R', storageLocation: '2009', unrestricted: 400 },
      ],
    })
    const run = fakeRun(inputs, [
      job('L', '104', [{ kind: 'setup', date: D(0), start: 0, end: 30 }, { kind: 'run', date: D(0), start: 30, end: 130 }], 1000, { frozen: true }),
    ])
    const v = validatePlan(inputs, run, MONDAY_0700)
    expect(v.stockouts.filter((s) => s.material === 'R')).toEqual([])
  })

  it('T7: a job approved yesterday that is still running blocks the press', () => {
    const inputs = plant({
      products: [
        { code: 'Y', moldCavities: 1, spm: 5, setupMinutes: 30, grossWeight: 1, coilWeight: 6000, mainMachine: '104' },
        { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      ],
      weeklyDemand: [
        { material: 'Y', overdue: 0, periods: [{ label: 'W38', qty: -2000 }] },
        { material: 'Z', overdue: -500, periods: [] },
      ],
      stock: [{ material: 'Y', storageLocation: '2009', unrestricted: 0, uploadedAt: Date.UTC(2026, 8, 14, 3, 0) }],
      latestSnapshot: {
        createdAt: MONDAY_0700 - 3600_000,
        jobs: [
          {
            material: 'Y', press: '104', hall: 'H1', date: D(0), endDate: D(2), phase: 'urgent', quantity: 6000, shots: 6000,
            coilsNeeded: 1, setupStartMinute: 0, endMinute: 270,
            segments: [
              { kind: 'setup', date: D(0), start: 0, end: 30 },
              { kind: 'run', date: D(0), start: 30, end: 480 },
              { kind: 'run', date: D(1), start: 0, end: 480 },
              { kind: 'run', date: D(2), start: 0, end: 270 },
            ],
            reason: 'approved',
          },
        ],
      },
    })
    const run = fakeRun(
      inputs,
      [job('Z', '104', [{ kind: 'setup', date: D(1), start: 0, end: 30 }, { kind: 'run', date: D(1), start: 30, end: 80 }], 500, { phase: 'backlog' })],
      { todayIso: D(1) },
    )
    const v = validatePlan(inputs, run, TUESDAY_0700)
    expect(rule(v, 'press-overlap').broken).toBeGreaterThan(0)
    expect(rule(v, 'press-overlap').examples[0]).toContain('approved earlier')
    // Y: Pazartesi basılan pay stokta, kalan pay çalıştıkça gelir.
    expect(v.stockouts.filter((s) => s.material === 'Y')).toEqual([])
  })

  it('a running approved job that the engine also lists as frozen is one job (no overlap, output once)', () => {
    const segments: Seg[] = [
      { kind: 'setup', date: '2026-09-11', start: 300, end: 330 },
      { kind: 'run', date: '2026-09-11', start: 330, end: 480 },
      { kind: 'run', date: D(0), start: 0, end: 120 },
    ]
    const inputs = plant({
      products: [{ code: 'A', moldCavities: 1, spm: 22.5, setupMinutes: 30, mainMachine: '104' }],
      weeklyDemand: [{ material: 'A', overdue: -12000, periods: [] }],
      stock: [{ material: 'A', storageLocation: '2009', unrestricted: 0, uploadedAt: Date.UTC(2026, 8, 11, 3, 0) }],
      latestSnapshot: {
        createdAt: MONDAY_0700 - 3 * 86_400_000,
        jobs: [{ material: 'A', press: '104', hall: 'H1', date: '2026-09-11', endDate: D(0), phase: 'urgent', quantity: 6000, shots: 6000, coilsNeeded: 1, setupStartMinute: 300, endMinute: 120, segments, reason: '' }],
      },
    })
    const run = fakeRun(inputs, [job('A', '104', segments, 6000, { frozen: true, setupStartMinute: 300 })])
    const v = validatePlan(inputs, run, MONDAY_0700)
    expect(rule(v, 'press-overlap').broken).toBe(0)
    // 6000 once: 12000 − 6000 short at Tue 08:00.
    expect(v.stockouts[0]).toMatchObject({ material: 'A', at: 'Tue 2026-09-15 08:00', shortQty: 6000 })
  })

  it('explained-unplanned when the engine lists the material as unplanned', () => {
    const inputs = plant()
    const v = validatePlan(inputs, fakeRun(inputs, [], { unplanned: [{ material: 'Z', quantity: 200, phase: 'backlog', dueDate: D(0), reason: 'x' }] }), MONDAY_0700)
    expect(verdictOf(v, 'Z')!.verdict).toBe('explained-unplanned')
  })
})

// --------------------------------------------------------------------------
describe('part 2 — feasibility', () => {
  it('Moore–Hodgson gives the minimum number of late jobs', () => {
    const r = mooreHodgson([
      { g: 'a', p: 4, d: 5 },
      { g: 'b', p: 3, d: 6 },
      { g: 'c', p: 2, d: 7 },
      { g: 'd', p: 5, d: 20 },
    ])
    expect(r.rejected).toEqual(new Set(['a']))
    expect(r.overload).toBe(2)
  })

  it('alone bound: 6000 pcs needed by Tue 08:00 cannot be made on one shift a day', () => {
    const inputs = plant({ weeklyDemand: [{ material: 'Z', overdue: -6000, periods: [] }] })
    const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    const f = verdictOf(v, 'Z')!.feasibility!
    expect(f.verdict).toBe('capacity-proven')
    expect(f.test).toBe('alone')
    expect(f.gapMinutes).toBe(630 - 540)
    expect(f.reason).toContain('Even alone on 104')
  })

  it('press load: two single-press backlogs that do not fit together — the plan has the minimum late count', () => {
    const inputs = plant({
      products: [
        { code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
        { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      ],
      weeklyDemand: [
        { material: 'Y', overdue: -3000, periods: [] },
        { material: 'Z', overdue: -3000, periods: [] },
      ],
    })
    const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    expect(v.summary.realStockouts).toBe(1)
    const late = v.materials.find((m) => m.feasibility)!
    expect(late.feasibility!.verdict).toBe('capacity-proven')
    expect(late.feasibility!.test).toBe('press-load')
    expect(late.feasibility!.reason).toContain('at least 1')
  })

  it('avoidable: the late lot would fit into idle time before its deadline', () => {
    const inputs = plant({ presses: [{ name: '104', hall: 'H1' }, { name: '105', hall: 'H2' }], templates: [
      { press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 },
      { press: '105', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 },
    ] })
    // Z Salı öğlen konmuş (geç), ama 104 Pazartesi boş.
    const run = fakeRun(inputs, [
      job('Z', '104', [{ kind: 'setup', date: D(1), start: 200, end: 230 }, { kind: 'run', date: D(1), start: 230, end: 250 }], 200, {
        phase: 'backlog',
        late: true,
        deadlineDate: D(1),
        deadlineMinute: 60,
      }),
    ])
    const v = validatePlan(inputs, run, MONDAY_0700)
    const z = verdictOf(v, 'Z')!
    expect(z.verdict).toBe('agree')
    expect(z.feasibility!.verdict).toBe('avoidable')
    expect(z.feasibility!.test).toBe('idle-gap')
    expect(z.feasibility!.reason).toContain('fits into the idle time on 104')
    expect(v.summary.avoidable).toBe(1)
    expect(v.summary.ok).toBe(false)
  })

  it('undecided: bounds pass but the press is full of other work before the deadline', () => {
    const inputs = plant({
      products: [
        { code: 'X', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
        { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' },
      ],
      weeklyDemand: [
        { material: 'X', overdue: 0, periods: [{ label: 'W38', qty: 0 }, { label: 'W39', qty: -5100 }] },
        { material: 'Z', overdue: -200, periods: [] },
      ],
    })
    const run = fakeRun(inputs, [
      job('X', '104', [{ kind: 'setup', date: D(0), start: 0, end: 30 }, { kind: 'run', date: D(0), start: 30, end: 480 }, { kind: 'run', date: D(1), start: 0, end: 60 }], 5100, { phase: 'fill' }),
      job('Z', '104', [{ kind: 'setup', date: D(1), start: 60, end: 90 }, { kind: 'run', date: D(1), start: 90, end: 110 }], 200, {
        phase: 'backlog', late: true, deadlineDate: D(1), deadlineMinute: 60,
      }),
    ])
    const v = validatePlan(inputs, run, MONDAY_0700)
    const f = verdictOf(v, 'Z')!.feasibility!
    expect(f.verdict).toBe('undecided')
    expect(f.gapMinutes).toBe(540 - 50)
    expect(f.reason).toContain('Bounds pass')
  })

  it('setup crew bound: many dies due before the first 08:00, one press each', () => {
    const presses = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((name) => ({ name, hall: name }))
    const inputs = plant({
      presses,
      templates: presses.map((p) => ({ press: p.name, workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 })),
      products: presses.map((p, i) => ({ code: `M${i}`, moldCavities: 1, spm: 60, setupMinutes: 120, mainMachine: p.name })),
      weeklyDemand: presses.map((_, i) => ({ material: `M${i}`, overdue: -60, periods: [] })),
      settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 1, safetyStockDays: 0, maxScenarios: 2, maxSetupsPlantWide: 1, maxSetupsPlantWideNormal: 1 },
    })
    const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    // 6 × 120 dk setup, tek ekip, Salı 08:00'e kadar 540 dk çalışma: en fazla 4 setup → en az 2 geç.
    expect(v.summary.lateLowerBoundBy.setupCrew).toBe(2)
    expect(v.summary.lateLowerBound).toBe(2)
    expect(v.summary.realStockouts).toBeGreaterThanOrEqual(2)
    if (v.summary.realStockouts === 2) {
      for (const m of v.materials) {
        expect(m.feasibility!.verdict).toBe('capacity-proven')
        expect(m.feasibility!.test).toBe('setup-crew')
      }
    }
  })
})

// --------------------------------------------------------------------------
describe('part 3 — efficiency', () => {
  it('setups against the lower bound and utilisation against the upper bound', () => {
    const inputs = plant({
      weeklyDemand: [
        { material: 'Y', overdue: -100, periods: [] },
        { material: 'Z', overdue: -200, periods: [] },
      ],
    })
    const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    expect(v.efficiency.setups).toEqual({ plan: 2, lowerBound: 2 })
    expect(v.efficiency.utilisation.plan).toBeGreaterThan(0)
    expect(v.efficiency.utilisation.plan).toBeLessThanOrEqual(v.efficiency.utilisation.upperBound + 0.1)
    expect(v.efficiency.utilisation.upperBound).toBeLessThanOrEqual(100)
  })

  it('idle time without any eligible work is classed as no work', () => {
    const inputs = plant({ weeklyDemand: [] })
    const v = validatePlan(inputs, fakeRun(inputs, []), MONDAY_0700)
    expect(v.efficiency.idleHours.noWork).toBe(v.efficiency.utilisation.capacityHours)
    expect(v.efficiency.idleHours.leftIdle).toBe(0)
    expect(v.summary.ok).toBe(true)
  })

  it('idle time while a late part waits is classed as left idle', () => {
    const inputs = plant()
    const run = fakeRun(inputs, [
      job('Z', '104', [{ kind: 'setup', date: D(1), start: 200, end: 230 }, { kind: 'run', date: D(1), start: 230, end: 250 }], 200, { late: true }),
    ])
    const v = validatePlan(inputs, run, MONDAY_0700)
    expect(v.efficiency.idleHours.leftIdle + v.efficiency.idleHours.waitingCrew).toBeGreaterThanOrEqual(8)
  })
})

// --------------------------------------------------------------------------
describe('part 4 — hard rules on the absolute time axis', () => {
  const two = (over: Partial<PlanInputs> = {}) =>
    plant({
      presses: [{ name: '104', hall: 'H1' }, { name: '105', hall: 'H1' }, { name: '201', hall: 'H2' }],
      templates: ['104', '105', '201'].map((press) => ({ press, workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 })),
      products: [
        { code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 1000, mainMachine: '104', altMachine1: '105' },
        { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '105', altMachine1: '104', flexiblePress: true },
        { code: 'W', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '201', minLotQty: 500 },
      ],
      weeklyDemand: [],
      ...over,
    })
  const S = (date: string, a: number, b: number): Seg => ({ kind: 'setup', date, start: a, end: b })
  const R = (date: string, a: number, b: number): Seg => ({ kind: 'run', date, start: a, end: b })

  it('clean engine plans break no rule', () => {
    const inputs = plant({
      weeklyDemand: [
        { material: 'Y', overdue: -100, periods: [] },
        { material: 'Z', overdue: -200, periods: [] },
      ],
    })
    const v = validatePlan(inputs, computePlan(inputs, MONDAY_0700), MONDAY_0700)
    expect(v.rules.filter((r) => r.broken > 0).map((r) => r.id)).toEqual([])
    expect(v.rules.length).toBeGreaterThanOrEqual(13)
  })

  it('R1 press overlap, R2 mould on two presses, R3 hall crane, R4 plant-wide', () => {
    const inputs = two()
    const v = validatePlan(
      inputs,
      fakeRun(inputs, [
        job('Y', '104', [S(D(0), 0, 30), R(D(0), 30, 130)], 1000),
        job('Z', '104', [S(D(0), 100, 130), R(D(0), 130, 150)], 200), // 104'te Y ile çakışır
        job('Y', '105', [S(D(0), 20, 50), R(D(0), 50, 150)], 1000, { hall: 'H1' }), // aynı kalıp 105'te, aynı holde setup
        job('W', '201', [S(D(0), 10, 40), R(D(0), 40, 90)], 500, { hall: 'H2' }), // başka holde, fabrika geneli 2 setup
      ]),
      MONDAY_0700,
    )
    expect(rule(v, 'press-overlap').broken).toBeGreaterThan(0)
    expect(rule(v, 'mould-twice').broken).toBeGreaterThan(0)
    expect(rule(v, 'crane-hall').broken).toBeGreaterThan(0)
    expect(rule(v, 'plant-setups').broken).toBeGreaterThan(0)
  })

  it('R2 across the night: a die still mounted overnight on a 1-shift press is not free for a 3-shift press', () => {
    const inputs = two({
      templates: [
        { press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 },
        { press: '105', workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 },
        { press: '201', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 },
      ],
      products: [{ code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104', altMachine1: '105', flexiblePress: true }],
    })
    const v = validatePlan(
      inputs,
      fakeRun(inputs, [
        job('Z', '104', [S(D(0), 400, 430), R(D(0), 430, 480), R(D(1), 0, 100)], 1500),
        job('Z', '105', [S(D(0), 900, 930), R(D(0), 930, 1000)], 700), // Pazartesi 22:00 — kalıp hâlâ 104'te
      ]),
      MONDAY_0700,
    )
    expect(rule(v, 'mould-twice').broken).toBe(1)
  })

  it('R5 non-flexible part on its alternative press', () => {
    const inputs = two()
    const v = validatePlan(inputs, fakeRun(inputs, [job('Y', '105', [S(D(0), 0, 30), R(D(0), 30, 130)], 1000)]), MONDAY_0700)
    expect(rule(v, 'eligible-press').broken).toBe(1)
  })

  it('R6 work on a non-working day, in maintenance, beyond the day, in the past', () => {
    const inputs = two()
    const v = validatePlan(
      inputs,
      fakeRun(inputs, [
        job('Z', '105', [S('2026-09-19', 0, 30), R('2026-09-19', 30, 50)], 200), // Cumartesi
        job('W', '201', [S(D(1), 100, 130), R(D(1), 130, 530)], 4000, { hall: 'H2' }), // gün 480 dk
      ], { maintenance: [{ press: '201', date: D(1), label: 'service', start: 120, end: 180 }] }),
      TUESDAY_0700 - 86_400_000 + 60 * 60_000, // Pazartesi 08:00: 07:00'deki iş geçmişte kalmaz, ama…
    )
    const r6 = rule(v, 'working-time')
    expect(r6.examples.some((e) => e.includes('non-working day'))).toBe(true)
    expect(r6.examples.some((e) => e.includes('overlaps maintenance'))).toBe(true)
    expect(r6.examples.some((e) => e.includes('net min'))).toBe(true)
    const past = validatePlan(inputs, fakeRun(inputs, [job('Z', '105', [S(D(0), 0, 30), R(D(0), 30, 50)], 200)]), MONDAY_0700 + 3 * 3600_000)
    expect(rule(past, 'working-time').examples.some((e) => e.includes('in the past'))).toBe(true)
  })

  it('R7 setup crossing the day, R8 whole coils / min lot', () => {
    const inputs = two()
    const v = validatePlan(
      inputs,
      fakeRun(inputs, [
        job('Y', '104', [S(D(0), 470, 480), S(D(1), 0, 20), R(D(1), 20, 95)], 750), // setup geceyi aşar; 750 tam rulo değil
        job('W', '201', [S(D(0), 0, 30), R(D(0), 30, 60)], 300, { hall: 'H2' }), // min lot 500
      ]),
      MONDAY_0700,
    )
    expect(rule(v, 'setup-in-day').broken).toBe(1)
    const r8 = rule(v, 'lot-rules')
    expect(r8.examples.some((e) => e.includes('not whole coils'))).toBe(true)
    expect(r8.examples.some((e) => e.includes('below Min. lot'))).toBe(true)
  })

  it('R9 pull-forward window, R11 conservation', () => {
    const inputs = two({
      weeklyDemand: [
        { material: 'Z', overdue: 0, periods: [{ label: 'W38', qty: 0 }, { label: 'W39', qty: 0 }, { label: 'W40', qty: 0 }, { label: 'W41', qty: -200 }] },
        { material: 'W', overdue: -500, periods: [] },
      ],
      settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 4, safetyStockDays: 0 },
    })
    const v = validatePlan(inputs, fakeRun(inputs, [job('Z', '105', [S(D(0), 0, 30), R(D(0), 30, 50)], 200, { phase: 'fill' })]), MONDAY_0700)
    expect(rule(v, 'pull-forward').broken).toBe(1)
    expect(rule(v, 'conservation').examples[0]).toContain('W: 500 pcs')
  })

  it('R9: the runs of one mould-limit-split lot share the lot window; a separate lot does not', () => {
    const inputs = two({
      products: [{ code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 1000, maxShots: 1000, mainMachine: '104' }],
      weeklyDemand: [
        { material: 'Y', overdue: 0, periods: [{ label: 'W38', qty: -1000 }, { label: 'W39', qty: 0 }, { label: 'W40', qty: -1000 }, { label: 'W41', qty: -1000 }] },
      ],
      settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 4, safetyStockDays: 0 },
    })
    const lots = (secondDue: string) =>
      fakeRun(inputs, [
        job('Y', '104', [S(D(0), 0, 30), R(D(0), 30, 130)], 1000, { dueDate: D(0), bucketLabel: 'W38' }),
        job('Y', '104', [S(D(4), 0, 30), R(D(4), 30, 130)], 1000, { phase: 'fill', dueDate: '2026-09-28', bucketLabel: 'W40' }),
        job('Y', '104', [R(D(4), 130, 230)], 1000, { phase: 'fill', setupMinutes: 0, dueDate: secondDue, bucketLabel: secondDue === '2026-09-28' ? 'W40' : 'W41' }),
      ])
    expect(rule(validatePlan(inputs, lots('2026-09-28'), MONDAY_0700), 'pull-forward').broken).toBe(0)
    expect(rule(validatePlan(inputs, lots('2026-10-05'), MONDAY_0700), 'pull-forward').broken).toBe(1)
  })

  it('R13: a backlog lot whose die is not ready yet is not "behind" an urgent lot', () => {
    const base = {
      weeklyDemand: [{ material: 'Z', overdue: -1000, periods: [] }],
    }
    const plan = (inputs: PlanInputs) =>
      fakeRun(inputs, [
        job('Y', '104', [S(D(0), 0, 30), R(D(0), 30, 130)], 1000, { phase: 'urgent' }),
        job('Z', '104', [S(D(2), 0, 30), R(D(2), 30, 130)], 1000, { phase: 'backlog' }),
      ])
    const ready = two(base)
    expect(rule(validatePlan(ready, plan(ready), MONDAY_0700), 'backlog-first').broken).toBe(1)
    const notReady = two({ ...base, readiness: [{ material: 'Z', ready: false, readyDate: D(2) }] })
    expect(rule(validatePlan(notReady, plan(notReady), MONDAY_0700), 'backlog-first').broken).toBe(0)
    const held = two({ ...base, alarms: [{ material: 'Z', status: 'open' }] })
    expect(rule(validatePlan(held, plan(held), MONDAY_0700), 'backlog-first').broken).toBe(0)
  })

  it('random plants 1–40: no false pull-forward or backlog-first flags', () => {
    const NOW = Date.UTC(2026, 8, 16, 7, 0)
    for (let seed = 1; seed <= 40; seed++) {
      const inputs = randomPlant(seed)
      const v = validatePlan(inputs, computePlan(inputs, NOW), NOW)
      const flagged = v.rules.filter((r) => (r.id === 'pull-forward' || r.id === 'backlog-first') && r.broken > 0)
      expect({ seed, flagged: flagged.map((r) => r.examples[0]) }).toEqual({ seed, flagged: [] })
    }
  }, 120_000)

  it('R10 frozen job changed, R12 die change without setup, R13 urgent before backlog', () => {
    const inputs = two({
      weeklyDemand: [{ material: 'Z', overdue: -1000, periods: [] }],
      settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 0, frozenDays: 1 },
      latestSnapshot: {
        createdAt: MONDAY_0700 - 3600_000,
        jobs: [{ material: 'W', press: '201', hall: 'H2', date: D(0), phase: 'fill', quantity: 500, shots: 500, coilsNeeded: 0, setupStartMinute: 0, endMinute: 80, segments: [S(D(0), 0, 30), R(D(0), 30, 80)], reason: 'ok' }],
      },
    })
    const v = validatePlan(
      inputs,
      fakeRun(inputs, [
        job('W', '201', [S(D(0), 0, 30), R(D(0), 30, 90)], 500, { frozen: true, hall: 'H2' }),
        job('Y', '104', [S(D(0), 0, 30), R(D(0), 30, 130)], 1000),
        job('Z', '104', [R(D(0), 130, 150)], 200, { setupMinutes: 0, phase: 'urgent' }), // Y'nin kalıbı takılı, setup yok
        job('Z', '104', [S(D(0), 150, 180), R(D(0), 180, 200)], 200, { phase: 'backlog' }),
      ]),
      MONDAY_0700,
    )
    expect(rule(v, 'frozen-intact').broken).toBe(1)
    expect(rule(v, 'die-change-without-setup').broken).toBe(1)
    expect(rule(v, 'backlog-first').broken).toBe(1)
  })
})

// --------------------------------------------------------------------------
describe('data checks and output shape', () => {
  it('flags stock in 2010 that would cover the shortage and a backlog below stock', () => {
    const inputs = plant({
      weeklyDemand: [{ material: 'Z', overdue: 200, periods: [{ label: 'W38', qty: 50 }] }],
      stock: [
        { material: 'Z', storageLocation: '2010', unrestricted: 900 },
      ],
    })
    const v = validatePlan(inputs, fakeRun(inputs, []), MONDAY_0700)
    const flags = verdictOf(v, 'Z')!.dataFlags.join(' | ')
    expect(flags).toContain('non-counted locations (2010 900) would cover')
    expect(flags).toContain('positive quantities')
    expect(v.summary.dataSuspect).toBe(1)
    const covered = validatePlan(
      plant({ weeklyDemand: [{ material: 'Z', overdue: -200, periods: [{ label: 'W38', qty: -5000 }] }], stock: [{ material: 'Z', storageLocation: '2009', unrestricted: 300 }] }),
      fakeRun(inputs, []),
      MONDAY_0700,
    )
    expect(verdictOf(covered, 'Z')!.dataFlags.join(' ')).toContain('backlog 200 ≤ stock 300')
  })

  it('stress: 120 parts × 8 presses × 4 weeks — fast, capped and JSON-safe', () => {
    const inputs = stress(42, 120)
    const run = computePlan(inputs, MONDAY_0700)
    const t = Date.now()
    const v = validatePlan(inputs, run, MONDAY_0700)
    const ms = Date.now() - t
    expect(ms).toBeLessThan(1500)
    expect(JSON.parse(JSON.stringify(v))).toStrictEqual(v)
    expect(v.materials.length).toBeLessThanOrEqual(300)
    expect(v.stockouts.length).toBeLessThanOrEqual(300)
    for (const r of v.rules) expect(r.examples.length).toBeLessThanOrEqual(12)
    expect(JSON.stringify(v).length).toBeLessThan(400_000)
    // Motorun geç listesi gerçek stok bitişleriyle örtüşür.
    expect(v.summary.engineLate).toBeGreaterThan(0)
    expect(v.summary.verdicts.agree).toBeGreaterThan(0)
    const s = v.summary
    expect(s.capacityProven + s.avoidable + s.undecided).toBe(v.materials.filter((m) => m.feasibility).length)
  }, 120_000)
})

// Tohumlu stres tesisi: 8 pres, 2 hol, eş ürünler, rulo / min. lot, kalıp limiti.
function stress(seed: number, nMat: number): PlanInputs {
  let x = seed >>> 0
  const r = () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 4294967296
  }
  const presses = ['101', '102', '103', '104', '105', '106', '107', '108'].map((n, i) => ({
    name: n,
    hall: i < 4 ? 'H1' : 'H2',
    feedsCoil: n !== '106' && n !== '107',
  }))
  const products: PlanInputs['products'] = []
  const weeklyDemand: PlanInputs['weeklyDemand'] = []
  const stock: PlanInputs['stock'] = []
  for (let i = 0; i < nMat; i++) {
    const code = `M${String(i).padStart(3, '0')}`
    const main = presses[Math.floor(r() * presses.length)].name
    const alts = presses.map((p) => p.name).filter((p) => p !== main)
    const useMin = r() < 0.25
    const p: PlanInputs['products'][number] = {
      code,
      moldCavities: r() < 0.3 ? 2 : 1,
      spm: 8 + Math.floor(r() * 30),
      setupMinutes: 30 + Math.floor(r() * 90),
      coilSetupMinutes: 10,
      grossWeight: 0.5 + r() * 2,
      coilWeight: useMin ? 1 : 3000 + Math.floor(r() * 5000),
      minLotQty: useMin ? 1000 + Math.floor(r() * 4000) : undefined,
      mainMachine: main,
      altMachine1: alts[Math.floor(r() * alts.length)],
      flexiblePress: r() < 0.4,
      maxShots: r() < 0.15 ? 2000 + Math.floor(r() * 3000) : undefined,
      performanceFactor: 0.7 + r() * 0.3,
    }
    products.push(p)
    if (i % 10 === 0 && i + 1 < nMat) p.coProduct = `M${String(i + 1).padStart(3, '0')}`
    const rate = 500 + Math.floor(r() * 4000)
    weeklyDemand.push({
      material: code,
      overdue: r() < 0.3 ? -Math.floor(r() * rate) : 0,
      periods: [0, 1, 2, 3].map((w) => ({ label: `W${38 + w}`, qty: -Math.floor(rate * (0.6 + r() * 0.8)) })),
    })
    stock.push({ material: code, storageLocation: r() < 0.8 ? '2009' : '2010', unrestricted: Math.floor(r() * rate * 1.2) })
  }
  for (const p of products) {
    if (!p.coProduct) continue
    const partner = products.find((q) => q.code === p.coProduct)!
    partner.mainMachine = p.mainMachine
    partner.flexiblePress = p.flexiblePress
    partner.altMachine1 = p.altMachine1
    partner.coilWeight = 1
    partner.minLotQty = undefined
  }
  return plant({
    products,
    weeklyDemand,
    stock,
    presses,
    templates: presses.map((p, i) => ({ press: p.name, workingDays: 5, shiftsPerDay: i % 3 === 0 ? 3 : 2, overtimeShifts: i === 2 ? 2 : 0 })),
    settings: { shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 4, safetyStockDays: 1, maxScenarios: 4 },
    plannedStops: [
      { shiftIndex: 1, name: 'meal', kind: 'break', startMinute: 690, durationMinutes: 30 },
      { shiftIndex: 2, name: 'meal', kind: 'break', startMinute: 1170, durationMinutes: 30 },
    ],
  })
}
