import { describe, expect, it } from 'vitest'

import { buildWeekBuckets, type DayBucket, type DemandEntry, type ProductSpec } from './planning'
import { schedule } from './scheduler'

// Kurallar (planlamacıyla netleşen):
//  - normal: setuplar fabrikada hiç çakışmaz, aynı holde arada 10 dk
//  - bakiye / geç kalacak iş: en fazla 2 setup aynı anda (fabrika geneli)
//  - setup vardiya değişimini aşabilir
//  - dolgu işi pres boş kalmasın diye en fazla N gün öne çekilir
//  - aciliyet yoksa aynı kalıbın işinin devamı (setup'sız) tercih edilir

const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
const monday = new Date('2026-09-14T00:00:00Z')
const rules = {
  setupGapMinutes: 10,
  concurrentSetupsPerHall: 1,
  maxSetupsPlantWide: 2,
  maxSetupsPlantWideNormal: 1,
  setupsCrossShifts: true,
}

function buckets(presses: string[], weeks = 1): Map<string, DayBucket[]> {
  const cal = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }
  return new Map(
    presses.map((p) => [
      p,
      Array.from({ length: weeks }, (_, w) =>
        buildWeekBuckets(new Date(monday.getTime() + w * 7 * 86_400_000), cal, settings),
      ).flat(),
    ]),
  )
}

const product = (code: string, press: string, extra: Partial<ProductSpec> = {}): [string, ProductSpec] => [
  code,
  { code, moldCavities: 1, spm: 10, setupMinutes: 60, mainMachine: press, ...extra } as ProductSpec,
]

const entry = (material: string, extra: Partial<DemandEntry> = {}): DemandEntry => ({
  material,
  qty: 600, // 60 dk üretim
  dueDate: '2026-09-14',
  earliestDate: '2026-09-14',
  bucketLabel: 'W38',
  phase: 'fill',
  urgency: 0,
  daysOfCover: 99,
  ...extra,
})

function setups(jobs: { press: string; segments: { kind: string; date: string; start: number; end: number }[] }[]) {
  return jobs.flatMap((j) => j.segments.filter((s) => s.kind === 'setup').map((s) => ({ press: j.press, ...s })))
}

function maxAtOnce(list: ReturnType<typeof setups>) {
  return Math.max(0, ...list.map((x) => list.filter((y) => y.date === x.date && y.start <= x.start && x.start < y.end).length))
}

const presses = [
  { name: 'P1', hall: 'H1' },
  { name: 'P2', hall: 'H2' },
  { name: 'P3', hall: 'H3' },
]

describe('setup rules', () => {
  it('normal jobs: setups never overlap anywhere in the plant', () => {
    const result = schedule(
      [entry('A'), entry('B'), entry('C')],
      new Map([product('A', 'P1'), product('B', 'P2'), product('C', 'P3')]),
      presses,
      buckets(['P1', 'P2', 'P3']),
      settings,
      rules,
    )
    expect(result.jobs).toHaveLength(3)
    expect(maxAtOnce(setups(result.jobs))).toBe(1)
    // Bekleyen presin boşluğu açıklanır.
    const waited = result.jobs.filter((j) => j.waitReason)
    expect(waited.length).toBeGreaterThan(0)
    expect(waited[0].waitReason).toMatch(/setup team busy — P\d is being set up/)
  })

  it('backlog: up to two setups at once plant-wide, never three', () => {
    const backlog = { phase: 'backlog' as const, urgency: 100, bucketLabel: 'Backlog' }
    const result = schedule(
      [entry('A', backlog), entry('B', backlog), entry('C', backlog)],
      new Map([product('A', 'P1'), product('B', 'P2'), product('C', 'P3')]),
      presses,
      buckets(['P1', 'P2', 'P3']),
      settings,
      rules,
    )
    const list = setups(result.jobs)
    expect(maxAtOnce(list)).toBe(2)
    expect(result.jobs.filter((j) => j.urgentSetup)).toHaveLength(3)
  })

  it('backlog: two setups may overlap in the same hall too (plant-wide limit), normal jobs never', () => {
    const oneHall = [
      { name: 'P1', hall: 'H1' },
      { name: 'P2', hall: 'H1' },
      { name: 'P3', hall: 'H1' },
    ]
    const backlog = { phase: 'backlog' as const, urgency: 100, bucketLabel: 'Backlog' }
    const urgent = schedule(
      [entry('A', backlog), entry('B', backlog), entry('C', backlog)],
      new Map([product('A', 'P1'), product('B', 'P2'), product('C', 'P3')]),
      oneHall,
      buckets(['P1', 'P2', 'P3']),
      settings,
      rules,
    )
    // Tek holde de iki setup aynı anda başlar; üçüncüsü bekler.
    expect(maxAtOnce(setups(urgent.jobs))).toBe(2)
    const normal = schedule(
      [entry('A'), entry('B'), entry('C')],
      new Map([product('A', 'P1'), product('B', 'P2'), product('C', 'P3')]),
      oneHall,
      buckets(['P1', 'P2', 'P3']),
      settings,
      rules,
    )
    expect(maxAtOnce(setups(normal.jobs))).toBe(1)
  })

  it('a setup may run over the shift change', () => {
    // P1 busy until 7 h 30 min into the first shift (450 min net); a 60-min
    // setup no longer fits before the shift ends at 480.
    const first = entry('A', { qty: 3900, phase: 'backlog' }) // 390 min + 60 setup = 450
    const second = entry('B', { phase: 'backlog' })
    const products = new Map([product('A', 'P1'), product('B', 'P1')])
    const cross = schedule([first, second], products, [presses[0]], buckets(['P1']), settings, rules)
    const b = cross.jobs.find((j) => j.material === 'B')!
    expect(b.segments[0]).toMatchObject({ kind: 'setup', start: 450, end: 510 })

    const strict = schedule([first, second], products, [presses[0]], buckets(['P1']), settings, {
      ...rules,
      setupsCrossShifts: false,
      shiftNetMinutes: [480, 480, 480],
    })
    const b2 = strict.jobs.find((j) => j.material === 'B')!
    expect(b2.segments[0].start).toBe(480)
    expect(b2.waitReason).toMatch(/shift change/)
  })

  it('pulls next week’s fill job into an idle press, at most N days early', () => {
    const next = entry('A', { dueDate: '2026-09-21', earliestDate: '2026-09-21', bucketLabel: 'W39' })
    const products = new Map([product('A', 'P1')])
    const pulled = schedule([next], products, [presses[0]], buckets(['P1'], 2), settings, {
      ...rules,
      pullForwardDays: 10,
    })
    expect(pulled.jobs[0].date).toBe('2026-09-14')
    expect(pulled.jobs[0].pulledForward).toBe(true)

    const limited = schedule([next], products, [presses[0]], buckets(['P1'], 2), settings, {
      ...rules,
      pullForwardDays: 3,
    })
    expect(limited.jobs[0].date).toBe('2026-09-18')

    const off = schedule([next], products, [presses[0]], buckets(['P1'], 2), settings, rules)
    expect(off.jobs[0].date).toBe('2026-09-21')
  })

  it('without urgency, continues the mounted die instead of a new setup elsewhere', () => {
    // A runs on P1; the next lot of A could also go to flexible P2 (earlier),
    // but continuing on P1 needs no setup.
    const products = new Map([
      product('A', 'P1', { flexiblePress: true, altMachine1: 'P2' } as Partial<ProductSpec>),
      product('X', 'P1'),
    ])
    const result = schedule(
      [
        entry('A', { phase: 'urgent', urgency: 50 }),
        entry('A', { bucketLabel: 'W39', dueDate: '2026-09-18', earliestDate: '2026-09-14' }),
      ],
      products,
      presses.slice(0, 2),
      buckets(['P1', 'P2']),
      settings,
      { ...rules, pullForwardDays: 10 },
    )
    const second = result.jobs.find((j) => j.bucketLabel === 'W39')!
    expect(second.press).toBe('P1')
    expect(second.continued).toBe(true)
    expect(second.setupMinutes).toBe(0)
  })
})
