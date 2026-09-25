import { describe, expect, it } from 'vitest'

import {
  buildCapacityForecast,
  capacityRows,
  groupPresses,
  pressNumber,
  sumSeries,
  type ForecastInput,
} from './capacityForecast'

const weeks = [
  { start: '2026-09-21', label: 'W39', holidays: [] },
  { start: '2026-09-28', label: 'W40', holidays: [] },
  { start: '2026-10-05', label: 'W41', holidays: [] },
]

function input(over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    products: [{ code: 'A', mainMachine: 'PRS-106', spm: 10, moldCavities: 2, performanceFactor: 0.6 }],
    weeklyDemand: [{ material: 'A', overdue: 1200, periods: [{ label: 'W39', qty: 1200 }, { label: 'W40', qty: 2400 }, { label: 'W41', qty: 0 }] }],
    stock: [],
    presses: ['PRS-106', 'PRS-107'],
    weeks,
    capacityMinutes: new Map([['PRS-106', [600, 600, 600]]]),
    ...over,
  }
}

describe('buildCapacityForecast', () => {
  it('turns demand into hours: pieces ÷ cavities ÷ SPM ÷ performance, backlog in this week', () => {
    const f = buildCapacityForecast(input())
    const a = f.presses.find((p) => p.press === 'PRS-106')!
    // (1200 + 1200) / 2 / 10 = 120 min pure → / 0.6 = 200 min = 3.33 h
    expect(a.demand).toEqual([3.33, 3.33, 0])
    expect(a.capacity).toEqual([10, 10, 10])
  })

  it('10 h of pure time counts as 16.67 h at 60 %', () => {
    const f = buildCapacityForecast(
      input({ weeklyDemand: [{ material: 'A', periods: [{ label: 'W39', qty: 12000 }] }] }),
    )
    // 12000 / 2 / 10 = 600 min = 10 h pure
    expect(f.presses[0].demand[0]).toBe(16.67)
  })

  it('deducts stock only from locations 2009 and 1009, earliest week first', () => {
    const f = buildCapacityForecast(
      input({
        stock: [
          { material: 'A', storageLocation: '2009', unrestricted: 2000 },
          { material: 'A', storageLocation: '1010', unrestricted: 99999 },
          { material: 'A', storageLocation: '2010', unrestricted: 99999 },
          { material: 'A', storageLocation: '1009', unrestricted: 1000 },
        ],
      }),
    )
    // 2400 in W39 fully covered, 600 left for W40: 2400 - 600 = 1800 pcs → 1.5 h pure → 2.5 h
    expect(f.presses[0].demand).toEqual([0, 2.5, 0])
  })

  it('counts a co-product pair once, by the side needing more strokes', () => {
    const f = buildCapacityForecast(
      input({
        products: [
          { code: 'L', coProduct: 'R', mainMachine: 'PRS-106', spm: 10, moldCavities: 1, performanceFactor: 1 },
          { code: 'R', mainMachine: 'PRS-106', spm: 10, moldCavities: 1 },
        ],
        weeklyDemand: [
          { material: 'R', periods: [{ label: 'W39', qty: 1200 }] },
          { material: 'L', periods: [{ label: 'W39', qty: 600 }] },
        ],
      }),
    )
    expect(f.presses[0].demand[0]).toBe(2) // 1200 strokes / 10 spm = 120 min
  })

  it('lists materials it cannot place, with the reason', () => {
    const f = buildCapacityForecast(
      input({
        products: [
          { code: 'A', mainMachine: 'PRS-999', spm: 10 },
          { code: 'B', mainMachine: 'PRS-106', spm: 0 },
        ],
        weeklyDemand: [
          { material: 'A', periods: [{ label: 'W39', qty: 10 }] },
          { material: 'B', periods: [{ label: 'W39', qty: 20 }] },
          { material: 'C', periods: [{ label: 'W39', qty: 5 }] },
        ],
      }),
    )
    expect(f.unassigned).toEqual([
      { material: 'B', reason: 'no SPM', quantity: 20 },
      { material: 'A', reason: 'main press PRS-999 is not defined', quantity: 10 },
      { material: 'C', reason: 'not in master data', quantity: 5 },
    ])
  })
})

describe('capacityRows', () => {
  it('matches the W39 report for the transfer line (106/7)', () => {
    // Report: prod 99 + 10 h backlog, then 196, 270+56 over, 231, 270+43 over.
    const rows = capacityRows({ capacity: [105, 270, 270, 270, 270], demand: [109, 196, 326, 231, 313] })
    expect(rows.map((r) => r.over)).toEqual([4, 0, 56, 0, 43])
    expect(rows.map((r) => r.idle)).toEqual([0, 74, 0, 39, 0])
    expect(rows.map((r) => r.load)).toEqual([105, 196, 270, 231, 270])
    // Report shows -5, 70, 14, 52, 9 (rounded per cell).
    expect(rows.map((r) => r.cumulative)).toEqual([-4, 70, 14, 53, 10])
  })
})

describe('groups', () => {
  it('builds the four report groups from press names, others on their own', () => {
    expect(pressNumber('PRS-106')).toBe('106')
    const groups = groupPresses(['PRS-104', 'PRS-105', 'PRS-106', 'PRS-107', 'PRS-108', 'PRS-110', 'PRS-103', 'PRS-109', 'PRS-200'])
    expect(groups).toEqual([
      { name: 'Transfer', presses: ['PRS-106', 'PRS-107'] },
      { name: '800T Line', presses: ['PRS-104', 'PRS-105', 'PRS-108', 'PRS-110'] },
      { name: 'PRS-103', presses: ['PRS-103'] },
      { name: 'PRS-109', presses: ['PRS-109'] },
      { name: 'PRS-200', presses: ['PRS-200'] },
    ])
  })

  it('sums press series into the group', () => {
    expect(sumSeries([{ capacity: [1, 2], demand: [3, 4] }, { capacity: [10, 20], demand: [0, 1] }], 2)).toEqual({
      capacity: [11, 22],
      demand: [3, 5],
    })
  })
})
