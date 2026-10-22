import { describe, expect, it } from 'vitest'

import { computePlan, type PlanInputs } from './planPipeline'

// Pazartesi 14 Eylül 2026, 07:00 Romanya — vardiya yeni başladı.
const MONDAY_0700 = Date.UTC(2026, 8, 14, 4, 0)

// Tek pres, günde tek vardiya (07:00–15:00, 480 dk). Y: 600 adet/saat, rulo 6000.
function plant(qty: number): PlanInputs {
  return {
    products: [{ code: 'Y', moldCavities: 1, spm: 10, setupMinutes: 30, grossWeight: 1, coilWeight: 6000, mainMachine: '104' }],
    weeklyDemand: [{ material: 'Y', overdue: -qty, periods: [] }],
    stock: [],
    locations: [{ code: '2009', countFinished: true, countRaw: true }, { code: '1009', countFinished: true, countRaw: true }],
    presses: [{ name: '104', hall: 'H1' }],
    templates: [{ press: '104', workingDays: 5, shiftsPerDay: 1, overtimeShifts: 0 }],
    settings: { timeZone: 'Europe/Bucharest', shiftMinutes: 480, shiftStartMinute: 420, planningHorizonWeeks: 2, safetyStockDays: 0 },
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
  }
}

describe('late is reported as a share of the needed quantity', () => {
  it('part of the need is ready at the deadline: x % on time, the rest late', () => {
    // Y: 6000 adet bakiye, 600 adet/saat → 10 saat üretim + 30 dk setup.
    // Pzt 07:30–15:00 = 4500 adet, Sal 07:00–08:00 = 600 adet → 08:00'e kadar
    // 5100 adet hazır. Kalan 900 adet Sal 09:30'a kadar sürer.
    const run = computePlan(plant(6000), MONDAY_0700)
    const item = run.lateItems![0]
    expect(item.neededQuantity).toBe(6000)
    expect(item.onTimeQty).toBe(5100)
    expect(item.lateQty).toBe(900)
    expect(item.lateHours).toBe(1.5)
    expect(item.calc).toMatchObject({ onTimeQty: 5100, lateQty: 900, lateHours: 1.5 })
    // Geç gelen 900 adetin ortalaması son parçadan küçük (düzgün akış: ~0,75 saat).
    expect(item.calc!.avgLateHours).toBeGreaterThan(0.5)
    expect(item.calc!.avgLateHours).toBeLessThan(1.5)
    expect(item.why![0]).toContain('85% (5,100 of 6,000 pcs)')
    expect(item.why![0]).toContain('the other 15% (900 pcs)')
    // Asıl neden: teslime kadar preste yeterli üretim süresi yok.
    expect(item.why!.join(' ')).toContain('Not enough press time before the deadline')
    expect(item.why!.join(' ')).toContain('short by 1.5 h')
  })

  it('nothing ready at the deadline: 0 % on time, all of the need is late', () => {
    // İkinci iş (Z) Y'nin arkasında: Y 08:00'e kadar basıyor, Z hiç başlamıyor.
    const base = plant(6000)
    const run = computePlan(
      {
        ...base,
        products: [...base.products, { code: 'Z', moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: '104' }],
        weeklyDemand: [...base.weeklyDemand, { material: 'Z', overdue: 0, periods: [{ label: '2026-W38', qty: 200 }] }],
      },
      MONDAY_0700,
    )
    const z = run.lateItems?.find((l) => l.material === 'Z')!
    expect(z).toBeDefined()
    expect(z.onTimeQty).toBe(0)
    expect(z.lateQty).toBe(z.neededQuantity)
    expect(z.why![0]).toContain('0% (0 of')
    expect(z.why![0]).toContain('the other 100%')
  })

  it('nothing is reported when everything is ready in time', () => {
    const run = computePlan(plant(3000), MONDAY_0700)
    expect(run.lateItems).toEqual([])
  })
})

describe('the independent validator agrees with the late share', () => {
  it('replays the same shortfall at the deadline', () => {
    const run = computePlan(plant(6000), MONDAY_0700)
    const item = run.lateItems![0]
    const row = (run.validation?.stockouts ?? []).find((r) => r.material === 'Y')
    expect(row).toBeDefined()
    expect(row!.shortQty).toBeCloseTo(item.lateQty!, -1)
    expect(row!.lateHours).toBeCloseTo(item.lateHours, 0)
  })
})
