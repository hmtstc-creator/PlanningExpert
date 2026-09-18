import { describe, expect, it } from 'vitest'

import {
  buildWeekBuckets,
  type DayBucket,
  type DemandEntry,
  type ProductSpec,
} from './planning'
import { schedule, type PlanOverride } from './scheduler'

const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
const options = { setupGapMinutes: 60, concurrentSetupsPerHall: 1 }
const monday = new Date('2026-09-14T00:00:00Z')

function bucketsFor(presses: string[], shiftsPerDay = 3): Map<string, DayBucket[]> {
  const map = new Map<string, DayBucket[]>()
  for (const p of presses) {
    map.set(p, buildWeekBuckets(monday, { workingDays: 5, shiftsPerDay, overtimeShifts: 0 }, settings))
  }
  return map
}

const baseProduct: ProductSpec & { mainMachine?: string } = {
  code: 'A',
  moldCavities: 1,
  spm: 100,
  grossWeight: 1,
  coilWeight: 10_000,
  setupMinutes: 30,
  coilSetupMinutes: 15,
  mainMachine: 'PRS-1',
}

const backlogEntry: DemandEntry = {
  material: 'A',
  qty: 500,
  dueDate: '2026-09-14',
  earliestDate: '2026-09-14',
  bucketLabel: 'Bakiye',
  phase: 'backlog',
  urgency: 100,
  daysOfCover: 0,
}

describe('schedule', () => {
  it('bakiyeyi uygun prese ilk günde yerleştirir', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs).toHaveLength(1)
    expect(result.jobs[0].press).toBe('PRS-1')
    expect(result.jobs[0].date).toBe('2026-09-14')
    expect(result.jobs[0].reason).toContain('Backlog')
  })

  it('aynı holde iki setupu en az bir saat arayla planlar', () => {
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...baseProduct, mainMachine: 'PRS-1' }],
      ['B', { ...baseProduct, code: 'B', mainMachine: 'PRS-2' }],
    ])
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      products,
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 1' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.jobs).toHaveLength(2)
    const [first, second] = result.jobs
    expect(Math.abs(second.setupStartMinute - first.setupStartMinute)).toBeGreaterThanOrEqual(60)
  })

  it('farklı hollerdeki setuplar aynı anda başlayabilir', () => {
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...baseProduct, mainMachine: 'PRS-1' }],
      ['B', { ...baseProduct, code: 'B', mainMachine: 'PRS-2' }],
    ])
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      products,
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.jobs.map((j) => j.setupStartMinute)).toEqual([0, 0])
  })

  it('aynı kalıbı aynı anda iki preste çalıştırmaz ama aynı güne planlayabilir', () => {
    const product = { ...baseProduct, altMachine1: 'PRS-2' }
    const result = schedule(
      [backlogEntry, { ...backlogEntry, qty: 400 }],
      new Map([['A', product]]),
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs).toHaveLength(2)
    // Eski davranış aynı malzemeyi aynı güne koymuyordu; artık koyabilir.
    expect(result.jobs[0].date).toBe(result.jobs[1].date)
    // Ama aynı kalıbın iki işi zaman olarak çakışamaz.
    const [a, b] = [...result.jobs].sort((x, y) => x.setupStartMinute - y.setupStartMinute)
    expect(b.setupStartMinute).toBeGreaterThanOrEqual(a.endMinute)
  })

  it('dolgu işini kendi haftasından önce planlamaz', () => {
    const fill: DemandEntry = {
      material: 'A',
      qty: 500,
      dueDate: '2026-09-17',
      earliestDate: '2026-09-17',
      bucketLabel: 'W38',
      phase: 'fill',
      urgency: 0,
      daysOfCover: 30,
    }
    const result = schedule(
      [fill],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs[0].date).toBe('2026-09-17')
    expect(result.jobs[0].late).toBe(false)
  })

  it('ihtiyaç haftasından sonraya kayan işi geç olarak işaretler', () => {
    const past: DemandEntry = {
      ...backlogEntry,
      dueDate: '2026-09-10',
      earliestDate: '2026-09-14',
    }
    const result = schedule(
      [past],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs[0].late).toBe(true)
    expect(result.jobs[0].reason).toContain('later than required week')
  })

  it('kalıp limitini aşan üretimi partilere bölerek planlar', () => {
    const limited = { ...baseProduct, maxShots: 300 }
    const result = schedule(
      [backlogEntry],
      new Map([['A', limited]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs.length).toBeGreaterThan(1)
    expect(result.jobs.every((j) => j.shots <= 300)).toBe(true)
  })

  it('pres tanımlı değilse gerekçesiyle planlanamadı listesine yazar', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', { ...baseProduct, mainMachine: 'YOK' }]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('No eligible press')
  })

  it('kapasite yetmezse planlanamadı listesine gerekçe yazar', () => {
    const huge = { ...backlogEntry, qty: 10_000_000 }
    const result = schedule(
      [huge],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1'], 1),
      settings,
      options,
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('capacity')
  })

  it('eş ürün miktarını işte taşır', () => {
    const withCo = { ...baseProduct, coProduct: 'B' }
    const result = schedule(
      [backlogEntry],
      new Map([['A', withCo]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.jobs[0].coProduct).toBe('B')
    expect(result.jobs[0].coProductQuantity).toBe(500)
  })

  it('hariç tutulan malzemeyi planlamaz ve gerekçesini yazar', () => {
    const overrides: PlanOverride[] = [{ material: 'A', kind: 'exclude' }]
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('Excluded from planning')
  })

  it('sabitlenen malzemeyi yalnızca o preste planlar', () => {
    const product = { ...baseProduct, altMachine1: 'PRS-2' }
    const overrides: PlanOverride[] = [{ material: 'A', kind: 'pin', press: 'PRS-2' }]
    const result = schedule(
      [backlogEntry],
      new Map([['A', product]]),
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs[0].press).toBe('PRS-2')
    expect(result.jobs[0].pinned).toBe(true)
    expect(result.jobs[0].reason).toContain('pinned by user')
  })

  it('sabitlenen gün dışına taşmaz', () => {
    const overrides: PlanOverride[] = [
      { material: 'A', kind: 'pin', press: 'PRS-1', date: '2026-09-16' },
    ]
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs[0].date).toBe('2026-09-16')
  })

  it('sabitlenen pres tanımsızsa gerekçesiyle planlanamadıya düşer', () => {
    const overrides: PlanOverride[] = [{ material: 'A', kind: 'pin', press: 'YOK' }]
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    expect(result.jobs).toHaveLength(0)
    expect(result.unplanned[0].reason).toContain('Pinned press is not defined')
  })

  it('öne alınan malzemeyi faz sırasından bağımsız olarak ilk sıraya koyar', () => {
    const fill: DemandEntry = {
      material: 'B',
      qty: 500,
      dueDate: '2026-09-14',
      earliestDate: '2026-09-14',
      bucketLabel: 'W38',
      phase: 'fill',
      urgency: 0,
      daysOfCover: 30,
    }
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...baseProduct, mainMachine: 'PRS-1' }],
      ['B', { ...baseProduct, code: 'B', mainMachine: 'PRS-1' }],
    ])
    const overrides: PlanOverride[] = [{ material: 'B', kind: 'priority' }]
    const result = schedule(
      [backlogEntry, fill],
      products,
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides },
    )
    // Bakiye normalde önce gelirdi; öne alma kuralı B'yi başa taşır.
    expect(result.jobs[0].material).toBe('B')
    expect(result.jobs[0].setupStartMinute).toBe(0)
  })
})

describe('vinç kısıtı ve rulo besleme', () => {
  const longSetup: ProductSpec & { mainMachine?: string } = {
    ...baseProduct,
    setupMinutes: 90,
    coilSetupMinutes: 0,
  }

  it('uzun setuplar aynı holde çakışmaz', () => {
    // Eski hata: yalnızca başlangıç saatleri karşılaştırılıyordu, 90 dakikalık
    // setup ile 60 dakika sonra başlayan setup "1 saat ara var" sayılıp
    // çakışıyordu. Vinç aynı anda iki yerde olamaz.
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...longSetup, mainMachine: 'PRS-1' }],
      ['B', { ...longSetup, code: 'B', mainMachine: 'PRS-2' }],
    ])
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      products,
      [
        { name: 'PRS-1', hall: 'Hall 1' },
        { name: 'PRS-2', hall: 'Hall 1' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.jobs).toHaveLength(2)
    const [a, b] = [...result.jobs].sort((x, y) => x.setupStartMinute - y.setupStartMinute)
    // İkinci setup, birincisi bitmeden VE vinç payı dolmadan başlayamaz.
    expect(b.setupStartMinute).toBeGreaterThanOrEqual(a.setupEndMinute + options.setupGapMinutes)
  })

  it('farklı hollerde uzun setuplar aynı anda olabilir', () => {
    const products = new Map<string, ProductSpec & { mainMachine?: string }>([
      ['A', { ...longSetup, mainMachine: 'PRS-1' }],
      ['B', { ...longSetup, code: 'B', mainMachine: 'PRS-2' }],
    ])
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      products,
      [
        { name: 'PRS-1', hall: 'Hall 1' },
        { name: 'PRS-2', hall: 'Hall 2' },
      ],
      bucketsFor(['PRS-1', 'PRS-2']),
      settings,
      options,
    )
    expect(result.jobs.map((j) => j.setupStartMinute)).toEqual([0, 0])
  })

  it('transfer preste rulo setup süresi eklenmez', () => {
    // Çok rulo gerektiren bir iş: rulo beslemeli preste rulo değişimi ek
    // süredir, transfer preste yoktur.
    const coilHungry: ProductSpec & { mainMachine?: string } = {
      ...baseProduct,
      coilWeight: 100,
      grossWeight: 1,
      coilSetupMinutes: 20,
      mainMachine: 'PRS-1',
    }
    const run = (feedsCoil: boolean) =>
      schedule(
        [backlogEntry],
        new Map([['A', coilHungry]]),
        [{ name: 'PRS-1', hall: 'Hall 1', feedsCoil }],
        bucketsFor(['PRS-1']),
        settings,
        options,
      ).jobs[0]

    const progressive = run(true)
    const transfer = run(false)
    expect(progressive.coilChanges).toBeGreaterThan(0)
    expect(transfer.coilChanges).toBe(0)
    // Kalıp setup'ı ikisinde de aynı; fark rulo değişimlerinde.
    expect(progressive.segments.some((seg) => seg.kind === 'coil')).toBe(true)
    expect(transfer.segments.some((seg) => seg.kind === 'coil')).toBe(false)
    expect(transfer.endMinute).toBeLessThan(progressive.endMinute)
  })

  it('rulo değişimlerini üretimin arasına yerleştirir, başa toplamaz', () => {
    // Rulodan 100 adet çıkıyor, 500 adet planlanıyor → 5 rulo, 4 değişim.
    const multiCoil: ProductSpec & { mainMachine?: string } = {
      ...baseProduct,
      coilWeight: 100,
      grossWeight: 1,
      coilSetupMinutes: 10,
      spm: 1, // her rulo 100 dakika üretim
      mainMachine: 'PRS-1',
    }
    const result = schedule(
      [backlogEntry],
      new Map([['A', multiCoil]]),
      [{ name: 'PRS-1', hall: 'Hall 1' }],
      bucketsFor(['PRS-1'], 3),
      settings,
      options,
    )
    const job = result.jobs[0]
    const kinds = job.segments.map((seg) => seg.kind)
    // setup, (onay yok), üretim, rulo, üretim, rulo, ...
    expect(kinds[0]).toBe('setup')
    expect(kinds[1]).toBe('run')
    expect(kinds.filter((k) => k === 'coil')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'run')).toHaveLength(5)
    // Her rulo değişimi iki üretim parçasının arasında.
    job.segments.forEach((seg, i) => {
      if (seg.kind !== 'coil') return
      expect(job.segments[i - 1].kind).toBe('run')
      expect(job.segments[i + 1].kind).toBe('run')
    })
  })

  it('aynı holde iki rulo değişimi 30 dakikadan yakın olamaz', () => {
    const multiCoil = (code: string, machine: string): ProductSpec & { mainMachine?: string } => ({
      ...baseProduct,
      code,
      coilWeight: 100,
      grossWeight: 1,
      coilSetupMinutes: 10,
      spm: 5, // her rulo 20 dakika üretim → değişimler sık gelir
      setupMinutes: 0,
      mainMachine: machine,
    })
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      new Map([
        ['A', multiCoil('A', 'PRS-1')],
        ['B', multiCoil('B', 'PRS-2')],
      ]),
      [
        { name: 'PRS-1', hall: 'Hall 1' },
        { name: 'PRS-2', hall: 'Hall 1' },
      ],
      bucketsFor(['PRS-1', 'PRS-2'], 3),
      settings,
      { ...options, coilSetupGapMinutes: 30 },
    )
    const coils = result.jobs
      .flatMap((j) => j.segments.filter((seg) => seg.kind === 'coil'))
      .sort((a, b) => a.start - b.start)
    for (let i = 1; i < coils.length; i++) {
      expect(coils[i].start).toBeGreaterThanOrEqual(coils[i - 1].end + 30)
    }
  })

  it('kalıp setup ile rulo setup kesişemez ama peş peşe gelebilir', () => {
    const withSetup: ProductSpec & { mainMachine?: string } = {
      ...baseProduct,
      setupMinutes: 40,
      coilWeight: 100,
      grossWeight: 1,
      coilSetupMinutes: 10,
      spm: 5,
      mainMachine: 'PRS-1',
    }
    const other: ProductSpec & { mainMachine?: string } = {
      ...withSetup,
      code: 'B',
      setupMinutes: 40,
      mainMachine: 'PRS-2',
    }
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      new Map([
        ['A', withSetup],
        ['B', other],
      ]),
      [
        { name: 'PRS-1', hall: 'Hall 1' },
        { name: 'PRS-2', hall: 'Hall 1' },
      ],
      bucketsFor(['PRS-1', 'PRS-2'], 3),
      settings,
      options,
    )
    const molds = result.jobs.flatMap((j) => j.segments.filter((s) => s.kind === 'setup'))
    const coils = result.jobs.flatMap((j) => j.segments.filter((s) => s.kind === 'coil'))
    for (const m of molds) {
      for (const c of coils) {
        const overlaps = m.start < c.end && c.start < m.end
        expect(overlaps).toBe(false)
      }
    }
  })
})
