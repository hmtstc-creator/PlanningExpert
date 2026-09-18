import { describe, expect, it } from 'vitest'

import { buildWeekBuckets, type DayBucket, type DemandEntry, type ProductSpec } from './planning'
import { schedule } from './scheduler'
import { addDays } from './dates'

/**
 * Motorun gerçekçi bir yükte ne kadar sürdüğü.
 *
 * Yerleştirme artık dolu aralıklar üzerinde arama yapıyor (boşluğa geri
 * dönük yerleşebilmek için). Bu aramanın iş sayısıyla birlikte patlamadığını
 * ölçmek gerekiyor: plan tarayıcıda hesaplanıyor, telefonda da açılıyor.
 */
describe('motor ölçeklenmesi', () => {
  function build(materialCount: number, pressCount: number, weeks: number) {
    const monday = new Date('2026-09-14T00:00:00Z')
    const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
    const presses = Array.from({ length: pressCount }, (_, i) => ({
      name: `PRS-${100 + i}`,
      hall: `Hall ${1 + (i % 3)}`,
    }))
    const buckets = new Map<string, DayBucket[]>()
    for (const press of presses) {
      const all: DayBucket[] = []
      for (let w = 0; w < weeks; w++) {
        all.push(
          ...buildWeekBuckets(
            addDays(monday, w * 7),
            { workingDays: 5, shiftsPerDay: 3, overtimeShifts: 0 },
            settings,
          ),
        )
      }
      buckets.set(press.name, all)
    }
    const products = new Map<string, ProductSpec>()
    const demand: DemandEntry[] = []
    for (let i = 0; i < materialCount; i++) {
      const code = `M${i}`
      products.set(code, {
        code,
        moldCavities: 1 + (i % 4),
        spm: 20 + (i % 40),
        grossWeight: 0.5 + (i % 5) / 10,
        coilWeight: 8000,
        setupMinutes: 20 + (i % 3) * 10,
        coilSetupMinutes: 15,
        qualityApprovalMinutes: 10,
        mainMachine: presses[i % pressCount].name,
        altMachine1: presses[(i + 1) % pressCount].name,
      } as ProductSpec)
      demand.push({
        material: code,
        qty: 2000 + (i % 7) * 1500,
        dueDate: '2026-09-14',
        earliestDate: '2026-09-14',
        bucketLabel: 'Bakiye',
        phase: 'backlog',
        urgency: 100,
        daysOfCover: 0,
      })
    }
    return { demand, products, presses, buckets, settings }
  }

  function run(materialCount: number, pressCount: number, weeks: number) {
    const { demand, products, presses, buckets, settings } = build(
      materialCount,
      pressCount,
      weeks,
    )
    const started = Date.now()
    const result = schedule(demand, products, presses, buckets, settings, {
      setupGapMinutes: 60,
      coilSetupGapMinutes: 30,
      concurrentSetupsPerHall: 1,
      shiftNetMinutes: [450, 465, 470],
    })
    return { ms: Date.now() - started, result }
  }

  it('600 malzeme / 12 pres / 4 hafta kapasite yeterken hızlı biter', () => {
    const { ms, result } = run(600, 12, 4)
    expect(result.jobs.length + result.unplanned.length).toBe(600)
    expect(result.unplanned).toHaveLength(0)
    // Plan tarayıcıda hesaplanıyor ve telefonda da açılıyor. Burada ölçülen
    // süre geliştirme makinesinde ~100 ms; sınır bol tutuldu ki yavaş bir
    // CI makinesinde gürültüden dolayı kırmızıya dönmesin. Yakalamak
    // istediğimiz şey saniyelere çıkan bir gerileme.
    expect(ms).toBeLessThan(3000)
  })

  it('tesis tıkalıyken bile makul sürede biter', () => {
    // Ufkun alabileceğinden fazla talep: motor her kalem için boş yer
    // arayıp bulamaz. Aramanın en pahalı hâli budur ve burada da bitmeli.
    const { ms, result } = run(1200, 12, 4)
    expect(result.unplanned.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(5000)
  })

  // Büyüme oranı ölçülmüyor. Süre, iş sayısıyla değil DOLULUKLA büyüyor:
  // kapasite varken yerleştirme ilk denemede tutuyor, tesis tıkanınca her
  // başarısız kalem tüm ufku tarıyor. İki ölçüm arasındaki oranı bir kurala
  // bağlamak, bu geçişi ölçüp rastgele kırmızıya dönen bir test üretiyordu.
})
