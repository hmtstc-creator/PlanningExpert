import { describe, expect, it } from 'vitest'

import { buildDemandSchedule, buildWeekBuckets, type ProductSpec } from './planning'
import { schedule } from './scheduler'

// Planlamacının örneği: 1000 bakiye, her hafta 2000 sipariş, stok yok,
// bir rulodan 6000 parça çıkıyor. Pazartesi 6000 basılınca bakiye + bu hafta
// + gelecek hafta + ondan sonraki haftanın 1000'i karşılanır. Bir sonraki
// rulo ne zaman? Stoğun bittiği günden emniyet stoğu günü kadar önce.

const monday = new Date(2026, 8, 14)
const product: ProductSpec = {
  code: 'A',
  moldCavities: 1,
  spm: 20,
  grossWeight: 1,
  coilWeight: 6000,
  setupMinutes: 30,
  mainMachine: '104',
}
const products = new Map([['A', product]])
const row = {
  material: 'A',
  overdue: -1000,
  periods: [0, 1, 2, 3].map((w) => ({ label: `W${38 + w}`, qty: -2000 })),
  stock: 0,
}

describe('lot timing from projected stock', () => {
  const entries = buildDemandSchedule([row], products, {
    baseMonday: monday,
    horizonWeeks: 4,
    today: '2026-09-14',
    safetyStockDays: 2,
  })

  it('makes one coil now for the backlog', () => {
    expect(entries[0]).toMatchObject({
      qty: 6000,
      phase: 'backlog',
      earliestDate: '2026-09-14',
    })
  })

  it('times the next coil two working days before the stock runs out', () => {
    // 6000 − 1000 − 2000 − 2000 = 1000 kalır; üçüncü haftada günde 400
    // tüketimle Çarşamba (30 Eylül) biter. 2 gün emniyet → Pazartesi 28.
    const next = entries[1]
    expect(next.qty).toBe(6000)
    expect(next.dueDate).toBe('2026-09-30')
    expect(next.earliestDate).toBe('2026-09-28')
    expect(next.phase).toBe('fill')
  })

  it('does not press the second coil straight after the first', () => {
    const buckets = new Map([
      [
        '104',
        [0, 1, 2, 3].flatMap((w) =>
          buildWeekBuckets(
            new Date(2026, 8, 14 + w * 7),
            { workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 },
            { shiftMinutes: 480, overtimeShiftMinutes: 480 },
          ),
        ),
      ],
    ])
    const result = schedule(entries, products, [{ name: '104', hall: 'H1' }], buckets, {
      shiftMinutes: 480,
      overtimeShiftMinutes: 480,
    }, { setupGapMinutes: 60, concurrentSetupsPerHall: 1 })
    expect(result.jobs).toHaveLength(2)
    expect(result.jobs[0].date).toBe('2026-09-14')
    expect(result.jobs[1].date).toBe('2026-09-28')
    expect(result.jobs[1].late).toBe(false)
  })

  it('with no safety stock, starts on the day the stock runs out', () => {
    const noSafety = buildDemandSchedule([row], products, {
      baseMonday: monday,
      horizonWeeks: 4,
      today: '2026-09-14',
      safetyStockDays: 0,
    })
    expect(noSafety[1].earliestDate).toBe('2026-09-30')
  })

  it('spreads this week only over the days that are left', () => {
    // Çarşamba çalıştırılırsa bu haftanın 2000'i Çar–Cuma'ya yayılır.
    const midweek = buildDemandSchedule(
      [{ material: 'A', overdue: 0, periods: [{ label: 'W38', qty: -2000 }, { label: 'W39', qty: -2000 }], stock: 3000 }],
      new Map(),
      { baseMonday: monday, horizonWeeks: 2, today: '2026-09-16', safetyStockDays: 0 },
    )
    // 3000 stok: bu haftanın 2000'i biter, 1000 kalır; gelecek hafta günde
    // 400 → Çarşamba 23 Eylül'de biter.
    expect(midweek[0].dueDate).toBe('2026-09-23')
  })
})
