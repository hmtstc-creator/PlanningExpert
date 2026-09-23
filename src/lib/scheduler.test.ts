import { describe, expect, it } from 'vitest'

import {
  buildWeekBuckets,
  type DayBucket,
  type DemandEntry,
  type ProductSpec,
} from './planning'
import { schedule, shiftEndAfter, type PlanOverride } from './scheduler'

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

describe('gün ve hafta sınırını aşan işler', () => {
  // Tek ruloya sığan, çok uzun süren bir iş: rulo değişimi araya girmesin.
  const longRun: ProductSpec & { mainMachine?: string } = {
    ...baseProduct,
    coilWeight: 100_000_000,
    setupMinutes: 30,
  }

  function twoWeekBuckets(press: string): Map<string, DayBucket[]> {
    const calendar = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }
    const nextMonday = new Date('2026-09-21T00:00:00Z')
    return new Map([
      [
        press,
        [
          ...buildWeekBuckets(monday, calendar, settings),
          ...buildWeekBuckets(nextMonday, calendar, settings),
        ],
      ],
    ])
  }

  it('gün kapasitesini aşan iş ertesi gün kaldığı yerden sürer', () => {
    // 200.000 adet / 100 spm = 2000 dk üretim; gün 1440 dk.
    const result = schedule(
      [{ ...backlogEntry, qty: 200_000 }],
      new Map([['A', longRun]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeekBuckets('PRS-1'),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    const [job] = result.jobs
    expect(job.date).toBe('2026-09-14')
    expect(job.spansDays).toBe(true)
    expect(job.endDate).toBe('2026-09-15')
    // İlk gün tam dolar, ikinci gün sıfırdan devam eder.
    const firstDay = job.segments.filter((seg) => seg.date === '2026-09-14')
    const secondDay = job.segments.filter((seg) => seg.date === '2026-09-15')
    expect(Math.max(...firstDay.map((seg) => seg.end))).toBe(1440)
    expect(Math.min(...secondDay.map((seg) => seg.start))).toBe(0)
    // Toplam süre korunur: setup 30 + üretim 2000.
    const total = job.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
    expect(total).toBe(2030)
    expect(job.endMinute).toBe(2030 - 1440)
  })

  it('hafta kapanışında yarım kalan iş sonraki haftaya devam eder', () => {
    // Hafta 1 kapasitesi 5 × 1440 = 7200 dk; iş 7500 dk üretim istiyor.
    const result = schedule(
      [{ ...backlogEntry, qty: 750_000 }],
      new Map([['A', longRun]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeekBuckets('PRS-1'),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    const [job] = result.jobs
    expect(job.date).toBe('2026-09-14')
    // Hafta 1'in son günü 18 Eylül; iş 21 Eylül'e taşar.
    expect(job.endDate).toBe('2026-09-21')
    const dates = Array.from(new Set(job.segments.map((seg) => seg.date)))
    expect(dates).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-21',
    ])
    // Yeni hafta sıfırdan başlamaz: kalan iş devam eder.
    const spill = job.segments.filter((seg) => seg.date === '2026-09-21')
    expect(spill.every((seg) => seg.kind === 'run')).toBe(true)
    expect(Math.min(...spill.map((seg) => seg.start))).toBe(0)
    expect(job.endMinute).toBe(7530 - 7200)
  })

  it('devam eden işten sonra sıradaki iş kaldığı yerden başlar', () => {
    const result = schedule(
      [
        { ...backlogEntry, qty: 200_000 },
        { ...backlogEntry, material: 'B', qty: 1000 },
      ],
      new Map([
        ['A', longRun],
        ['B', { ...longRun, code: 'B' }],
      ]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeekBuckets('PRS-1'),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    const [first, second] = result.jobs
    expect(first.endDate).toBe('2026-09-15')
    // İkinci iş, birincinin bittiği gün ve dakikadan sonra başlar.
    expect(second.date).toBe('2026-09-15')
    expect(second.setupStartMinute).toBeGreaterThanOrEqual(first.endMinute)
  })
})

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
    expect(result.jobs[0].reason).toContain('starts after the stock runs out')
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
    // Vinç kısıtı gün bazındadır: iş gün sınırını aşabildiği için parçalar
    // önce kendi gününe göre gruplanır.
    const byDate = new Map<string, { start: number; end: number }[]>()
    for (const seg of result.jobs.flatMap((j) =>
      j.segments.filter((s) => s.kind === 'coil'),
    )) {
      const list = byDate.get(seg.date) ?? []
      list.push({ start: seg.start, end: seg.end })
      byDate.set(seg.date, list)
    }
    let checked = 0
    for (const list of byDate.values()) {
      list.sort((a, b) => a.start - b.start)
      for (let i = 1; i < list.length; i++) {
        expect(list[i].start).toBeGreaterThanOrEqual(list[i - 1].end + 30)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
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

describe('vardiya sınırı', () => {
  it('eşit olmayan vardiyalarda sınırı doğru yere koyar', () => {
    // Devir toplantısı ve yemek her vardiyada farklı: 450 / 465 / 470.
    const shifts = [450, 465, 470]
    const capacity = 1385
    expect(shiftEndAfter(0, shifts, capacity)).toBe(450)
    expect(shiftEndAfter(449, shifts, capacity)).toBe(450)
    expect(shiftEndAfter(450, shifts, capacity)).toBe(915)
    expect(shiftEndAfter(914, shifts, capacity)).toBe(915)
    expect(shiftEndAfter(915, shifts, capacity)).toBe(1385)
  })

  it('gün kapasitesini aşmaz', () => {
    // Gün iki vardiya çalışıyorsa üçüncü vardiyanın sınırı gün sonudur.
    expect(shiftEndAfter(500, [450, 465, 470], 915)).toBe(915)
  })

  it('vardiya tanımı yoksa gün tek parçadır', () => {
    expect(shiftEndAfter(100, undefined, 480)).toBe(480)
    expect(shiftEndAfter(100, [], 480)).toBe(480)
  })

  it('sıfır uzunluklu vardiyayı atlar', () => {
    expect(shiftEndAfter(0, [0, 480], 480)).toBe(480)
  })

  it('setup kendi vardiyasına sığmıyorsa sonraki vardiyaya atılır', () => {
    // 1. vardiya 450 dk (30 dk duruş), 45 dakikalık setup 420. dakikada
    // başlayamaz — vardiya biterken yarım kalırdı.
    const longSetup: ProductSpec & { mainMachine?: string } = {
      ...baseProduct,
      setupMinutes: 45,
      spm: 1,
      coilWeight: 1_000_000,
    }
    const buckets = new Map<string, DayBucket[]>([
      ['PRS-1', [{ date: '2026-09-14', dayKey: 'MO', shifts: 3, isOvertime: false, isHoliday: false, minutes: 1385 }]],
    ])
    const result = schedule(
      [
        { ...backlogEntry, material: 'A', qty: 410 },
        { ...backlogEntry, material: 'B', qty: 10 },
      ],
      new Map([
        ['A', longSetup],
        ['B', { ...longSetup, code: 'B' }],
      ]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      buckets,
      settings,
      { ...options, setupGapMinutes: 0, shiftNetMinutes: [450, 465, 470] },
    )
    const b = result.jobs.find((j) => j.material === 'B')
    expect(b).toBeDefined()
    // A: 45 setup + 410 üretim = 455. B'nin setup'ı 455'te başlarsa 500'de
    // biter — 1. vardiya 450'de kapandığı için bu zaten 2. vardiyadadır ve
    // 2. vardiya 915'te kapanır, yani sığar.
    expect(b!.setupStartMinute).toBeGreaterThanOrEqual(455)
    expect(b!.setupStartMinute + 45).toBeLessThanOrEqual(915)
  })
})

describe('kalıp bakımı', () => {
  const twoWeeks = (press: string) => {
    const calendar = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }
    return new Map([
      [
        press,
        [
          ...buildWeekBuckets(monday, calendar, settings),
          ...buildWeekBuckets(new Date('2026-09-21T00:00:00Z'), calendar, settings),
        ],
      ],
    ])
  }

  it('bakım günü işi o güne koymaz, ertesi güne alır', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks('PRS-1'),
      settings,
      { ...options, moldBlackouts: [{ material: 'A', date: '2026-09-14' }] },
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs[0].date).toBe('2026-09-15')
    expect(result.jobs[0].segments.every((s) => s.date !== '2026-09-14')).toBe(true)
  })

  it('bakım malzemeyi ufuktan atmaz, sadece o günü kapatır', () => {
    // Üç gün üst üste bakım varsa iş dördüncü güne düşer, düşmeden kalmaz.
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks('PRS-1'),
      settings,
      {
        ...options,
        moldBlackouts: [
          { material: 'A', date: '2026-09-14' },
          { material: 'A', date: '2026-09-15' },
          { material: 'A', date: '2026-09-16' },
        ],
      },
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs[0].date).toBe('2026-09-17')
  })

  it('başka malzemeyi etkilemez', () => {
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      new Map([
        ['A', baseProduct],
        ['B', { ...baseProduct, code: 'B' }],
      ]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks('PRS-1'),
      settings,
      { ...options, moldBlackouts: [{ material: 'A', date: '2026-09-14' }] },
    )
    const b = result.jobs.find((j) => j.material === 'B')!
    expect(b.date).toBe('2026-09-14')
  })

  it('gün sınırını aşan iş bakım gününe taşamaz', () => {
    // 2000 dk'lık iş 14 Eylül'de başlasa 15'ine taşardı; 15'i bakımda.
    const longRun: ProductSpec & { mainMachine?: string } = {
      ...baseProduct,
      coilWeight: 100_000_000,
    }
    const result = schedule(
      [{ ...backlogEntry, qty: 200_000 }],
      new Map([['A', longRun]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks('PRS-1'),
      settings,
      { ...options, moldBlackouts: [{ material: 'A', date: '2026-09-15' }] },
    )
    expect(result.unplanned).toHaveLength(0)
    const [job] = result.jobs
    expect(job.segments.some((s) => s.date === '2026-09-15')).toBe(false)
    expect(job.date).toBe('2026-09-16')
  })
})

describe('boşluğa geri dönük yerleştirme', () => {
  const twoWeeks = (press: string) => {
    const calendar = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }
    return new Map([
      [
        press,
        [
          ...buildWeekBuckets(monday, calendar, settings),
          ...buildWeekBuckets(new Date('2026-09-21T00:00:00Z'), calendar, settings),
        ],
      ],
    ])
  }

  it('ertelenen iş arkasındaki günü boş bırakmaz', () => {
    // A bakım yüzünden 15'ine itiliyor. Eski modelde imleç de ileri kayar ve
    // 14 Eylül tümüyle boşa giderdi; sahada o presi boş bırakmazlar.
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      new Map([
        ['A', baseProduct],
        ['B', { ...baseProduct, code: 'B' }],
      ]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks('PRS-1'),
      settings,
      { ...options, moldBlackouts: [{ material: 'A', date: '2026-09-14' }] },
    )
    const a = result.jobs.find((j) => j.material === 'A')!
    const b = result.jobs.find((j) => j.material === 'B')!
    expect(a.date).toBe('2026-09-15')
    expect(b.date).toBe('2026-09-14')
  })

  it('geri dönük yerleşen iş çalışan işin üstüne binmez', () => {
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }, { ...backlogEntry, material: 'C' }],
      new Map([
        ['A', baseProduct],
        ['B', { ...baseProduct, code: 'B' }],
        ['C', { ...baseProduct, code: 'C' }],
      ]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks('PRS-1'),
      settings,
      { ...options, moldBlackouts: [{ material: 'A', date: '2026-09-14' }] },
    )
    // Aynı gün ve preste hiçbir iş bir diğeriyle çakışmaz.
    const byDate = new Map<string, { start: number; end: number }[]>()
    for (const job of result.jobs) {
      for (const seg of job.segments) {
        const list = byDate.get(seg.date) ?? []
        list.push({ start: seg.start, end: seg.end })
        byDate.set(seg.date, list)
      }
    }
    for (const list of byDate.values()) {
      list.sort((x, y) => x.start - y.start)
      for (let i = 1; i < list.length; i++) {
        expect(list[i].start).toBeGreaterThanOrEqual(list[i - 1].end)
      }
    }
  })

  it('araya boşluk girse de takılı kalıp için setup tekrarlanmaz', () => {
    // Aynı malzemenin iki partisi peş peşe gelir: ikincisinde kalıp zaten
    // takılıdır.
    const splitProduct: ProductSpec & { mainMachine?: string } = {
      ...baseProduct,
      maxShots: 300,
    }
    const result = schedule(
      [{ ...backlogEntry, qty: 600 }],
      new Map([['A', splitProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks('PRS-1'),
      settings,
      options,
    )
    expect(result.jobs.length).toBeGreaterThan(1)
    expect(result.jobs[0].setupMinutes).toBe(baseProduct.setupMinutes)
    expect(result.jobs[1].setupMinutes).toBe(0)
    expect(result.jobs[1].reason).toContain('setup not repeated')
  })
})

describe('dondurulmuş ufuk', () => {
  const twoWeeks = (presses: string[]) => {
    const calendar = { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 }
    const map = new Map<string, DayBucket[]>()
    for (const press of presses) {
      map.set(press, [
        ...buildWeekBuckets(monday, calendar, settings),
        ...buildWeekBuckets(new Date('2026-09-21T00:00:00Z'), calendar, settings),
      ])
    }
    return map
  }

  const frozenJob = {
    material: 'F',
    press: 'PRS-1',
    date: '2026-09-14',
    segments: [
      { kind: 'setup', date: '2026-09-14', start: 0, end: 60 },
      { kind: 'run', date: '2026-09-14', start: 60, end: 600 },
    ],
  }

  it('taahhüt edilmiş işin üstüne yeni iş konmaz', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks(['PRS-1']),
      settings,
      { ...options, fixedJobs: [frozenJob] },
    )
    const [job] = result.jobs
    // Donmuş iş 0–600 arasını kaplıyor; yeni iş ancak sonrasında başlar.
    expect(job.date).toBe('2026-09-14')
    expect(job.setupStartMinute).toBeGreaterThanOrEqual(600)
  })

  it('donmuş işin setup\'ı vinç kaydına girer', () => {
    // Aynı holdeki ikinci pres, donmuş setup'la çakışan bir setup yapamaz.
    const result = schedule(
      [backlogEntry],
      new Map([['A', { ...baseProduct, mainMachine: 'PRS-2' }]]),
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 1' },
      ],
      twoWeeks(['PRS-1', 'PRS-2']),
      settings,
      { ...options, fixedJobs: [frozenJob], setupGapMinutes: 60 },
    )
    const [job] = result.jobs
    expect(job.press).toBe('PRS-2')
    // Donmuş setup 0–60; vinç kuralı gereği sonraki setup en erken 120.
    expect(job.setupStartMinute).toBeGreaterThanOrEqual(120)
  })

  it('donmuş işin kalıbı aynı anda başka preste çalışamaz', () => {
    const result = schedule(
      [{ ...backlogEntry, material: 'F' }],
      new Map([['F', { ...baseProduct, code: 'F', mainMachine: 'PRS-2' }]]),
      [
        { name: 'PRS-1', hall: 'Hol 1' },
        { name: 'PRS-2', hall: 'Hol 2' },
      ],
      twoWeeks(['PRS-1', 'PRS-2']),
      settings,
      { ...options, fixedJobs: [frozenJob] },
    )
    const [job] = result.jobs
    expect(job.press).toBe('PRS-2')
    // F kalıbı 14 Eylül 0–600 arası PRS-1'de; PRS-2'de ancak sonrasında.
    const onSameDay = job.segments.filter((s) => s.date === '2026-09-14')
    expect(onSameDay.every((s) => s.start >= 600)).toBe(true)
  })

  it('tanımsız prese ait taahhüt planı bozmaz', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      twoWeeks(['PRS-1']),
      settings,
      { ...options, fixedJobs: [{ ...frozenJob, press: 'PRS-GONE' }] },
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs[0].setupStartMinute).toBe(0)
  })
})

describe('gün içinde geçmiş saatler', () => {
  it('bugünün işi geçip gitmiş saate çizilmez', () => {
    // Gün 1385 dk; 300 dakikası geçmiş, geriye 1085 var. İş bu günün
    // 300. dakikasından SONRA başlamalı — 0'dan değil, yoksa grafikte
    // sabaha, yani geçmişe çizilir.
    const buckets = new Map<string, DayBucket[]>([
      [
        'PRS-1',
        [
          {
            date: '2026-09-14',
            dayKey: 'MO',
            shifts: 3,
            isOvertime: false,
            isHoliday: false,
            minutes: 1085,
            startMinute: 300,
          },
        ],
      ],
    ])
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      buckets,
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    const [job] = result.jobs
    expect(job.setupStartMinute).toBeGreaterThanOrEqual(300)
    for (const seg of job.segments) {
      expect(seg.start).toBeGreaterThanOrEqual(300)
      expect(seg.end).toBeLessThanOrEqual(1385)
    }
  })

  it('geçmiş saat yoksa gün sıfırdan başlar', () => {
    const buckets = new Map<string, DayBucket[]>([
      [
        'PRS-1',
        [
          {
            date: '2026-09-14',
            dayKey: 'MO',
            shifts: 3,
            isOvertime: false,
            isHoliday: false,
            minutes: 1385,
          },
        ],
      ],
    ])
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      buckets,
      settings,
      options,
    )
    expect(result.jobs[0].setupStartMinute).toBe(0)
  })
})

describe('ömür alarmı planı durdurur', () => {
  it('alarmlı kalıp plandan çıkar, sebebi yazılır', () => {
    // Alarm süresiz bir kapalılık olduğu için motora `exclude` gelir.
    const result = schedule(
      [backlogEntry, { ...backlogEntry, material: 'B' }],
      new Map([
        ['A', baseProduct],
        ['B', { ...baseProduct, code: 'B' }],
      ]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      { ...options, overrides: [{ material: 'A', kind: 'exclude' }] },
    )
    expect(result.jobs.map((j) => j.material)).toEqual(['B'])
    const held = result.unplanned.find((u) => u.material === 'A')!
    expect(held.reason).toContain('Excluded from planning')
    // Miktar kaybolmaz: ne kadarının beklediği görünür.
    expect(held.quantity).toBe(backlogEntry.qty)
  })

  it('alarm kapanınca kalıp plana geri döner', () => {
    const result = schedule(
      [backlogEntry],
      new Map([['A', baseProduct]]),
      [{ name: 'PRS-1', hall: 'Hol 1' }],
      bucketsFor(['PRS-1']),
      settings,
      options,
    )
    expect(result.unplanned).toHaveLength(0)
    expect(result.jobs[0].material).toBe('A')
  })
})
