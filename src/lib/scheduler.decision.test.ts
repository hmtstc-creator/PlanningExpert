import { describe, expect, it } from 'vitest'

import { buildWeekBuckets, type DayBucket, type DemandEntry, type ProductSpec } from './planning'
import { schedule } from './scheduler'

// Planlamacının sorusu: 104 ve 105'te üretilebilen bir parça, 104'te
// dördüncü sıraya yazılırsa, 105'te daha erken bitemez miydi? Motor her iş
// için TÜM uygun presleri dener ve en erken biteni seçer; karar izi bunu
// gösterir.

const settings = { shiftMinutes: 480, overtimeShiftMinutes: 480 }
const monday = new Date(2026, 8, 14)

function buckets(presses: string[]): Map<string, DayBucket[]> {
  return new Map(
    presses.map((p) => [
      p,
      buildWeekBuckets(monday, { workingDays: 5, shiftsPerDay: 2, overtimeShifts: 0 }, settings),
    ]),
  )
}

function product(code: string, main: string, alt?: string): ProductSpec {
  return { code, moldCavities: 1, spm: 10, setupMinutes: 30, mainMachine: main, altMachine1: alt }
}

function backlog(material: string, qty: number): DemandEntry {
  return {
    material,
    qty,
    dueDate: '2026-09-14',
    earliestDate: '2026-09-14',
    bucketLabel: 'Backlog',
    phase: 'backlog',
    urgency: 100,
    daysOfCover: 0,
  }
}

describe('placement decision', () => {
  it('puts a job on the alternative press when that finishes it earlier, and says why', () => {
    const products = new Map([
      ['BIG', product('BIG', '104')],
      ['A', product('A', '104', '105')],
    ])
    const result = schedule(
      [backlog('BIG', 6000), backlog('A', 1000)],
      products,
      [
        { name: '104', hall: 'H1' },
        { name: '105', hall: 'H1' },
      ],
      buckets(['104', '105']),
      settings,
      { setupGapMinutes: 60, concurrentSetupsPerHall: 1 },
    )

    const big = result.jobs.find((j) => j.material === 'BIG')!
    const a = result.jobs.find((j) => j.material === 'A')!
    expect(big.decision?.step).toBe(1)
    expect(a.decision?.step).toBe(2)
    // 104 BIG ile dolu; A 105'e gider.
    expect(a.press).toBe('105')
    const on104 = a.decision!.candidates.find((c) => c.press === '104')!
    const on105 = a.decision!.candidates.find((c) => c.press === '105')!
    expect(on104.endDate).toBeDefined()
    expect(
      on105.endDate! < on104.endDate! ||
        (on105.endDate === on104.endDate && on105.endMinute! < on104.endMinute!),
    ).toBe(true)
  })

  it('records why a press could not take the job', () => {
    const products = new Map([['A', product('A', '104', '105')]])
    const result = schedule(
      [backlog('A', 500)],
      products,
      [
        { name: '104', hall: 'H1' },
        { name: '105', hall: 'H1' },
      ],
      new Map([
        ['104', buckets(['104']).get('104')!],
        ['105', []],
      ]),
      settings,
      { setupGapMinutes: 60, concurrentSetupsPerHall: 1 },
    )
    expect(result.jobs[0].press).toBe('104')
    expect(result.jobs[0].decision?.candidates).toContainEqual({
      press: '105',
      note: 'no working time in the horizon',
    })
  })

  it('places the part with fewer eligible presses first when the priority is equal', () => {
    // X 104 veya 105'te, Y yalnızca 104'te yapılabilir. İkisi de bakiye ve
    // dosyada X önce geliyor. X önce yerleşseydi 104'ü alır, Y onun arkasına
    // düşerdi. Tek presli Y önce yerleşir, X 105'e gider.
    const products = new Map([
      ['X', product('X', '104', '105')],
      ['Y', product('Y', '104')],
    ])
    const result = schedule(
      [backlog('X', 1000), backlog('Y', 1000)],
      products,
      [
        { name: '104', hall: 'H1' },
        { name: '105', hall: 'H2' },
      ],
      buckets(['104', '105']),
      settings,
      { setupGapMinutes: 60, concurrentSetupsPerHall: 1 },
    )
    const x = result.jobs.find((j) => j.material === 'X')!
    const y = result.jobs.find((j) => j.material === 'Y')!
    expect(y.decision?.step).toBe(1)
    expect(y.press).toBe('104')
    expect(x.press).toBe('105')
    expect(x.setupStartMinute).toBe(0)
    expect(y.setupStartMinute).toBe(0)
  })
})
