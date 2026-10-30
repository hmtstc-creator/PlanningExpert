import { describe, expect, it } from 'vitest'

import { allocateOperators, OPERATOR_EXAMPLE, weekEndOf, type OperatorAllocationInput } from './operatorAllocation'

const base = (over: Partial<OperatorAllocationInput> = {}): OperatorAllocationInput => ({ ...OPERATOR_EXAMPLE, ...over })

describe('operatorAllocation', () => {
  it('Planning Logic example: 3 operators, 5 lines, one without balance → the 3 most urgent lines run', () => {
    const { dayShifts, decisions } = allocateOperators(OPERATOR_EXAMPLE)
    expect(decisions).toEqual([
      { costCenter: 'CC-WELD', date: '2026-11-02', shift: 1, operators: 3, open: ['L1', 'L3', 'L2'], idle: 0 },
    ])
    // L4: adam kalmadı; L5: bakiyesi yok → ikisi de o gün kapalı.
    expect(dayShifts).toEqual([
      { press: 'L4', date: '2026-11-02', shifts: [] },
      { press: 'L5', date: '2026-11-02', shifts: [] },
    ])
  })

  it('a day × shift without headcount keeps the calendar', () => {
    const { dayShifts, decisions } = allocateOperators(base({ headcount: [] }))
    expect(dayShifts).toEqual([])
    expect(decisions).toEqual([])
  })

  it('a manual day record always wins and its crew is taken from the headcount first', () => {
    const { dayShifts, decisions } = allocateOperators(
      base({ manualDayShifts: [{ press: 'L5', date: '2026-11-02', shifts: [1] }] }),
    )
    expect(decisions[0].open).toEqual(['L5', 'L1', 'L3'])
    expect(dayShifts.map((d) => d.press)).toEqual(['L2', 'L4'])
  })

  it('a line whose crew does not fit is skipped; a smaller crew further down still opens', () => {
    const input = base({
      costCenters: [{ code: 'CC-WELD', lines: [{ press: 'L1', crewSize: 2 }, { press: 'L2', crewSize: 2 }, { press: 'L4', crewSize: 1 }] }],
    })
    expect(allocateOperators(input).decisions[0].open).toEqual(['L1', 'L4'])
  })

  it('an opened shift is deducted; a finished line takes no operators the next day', () => {
    const input = base({
      dates: ['2026-11-02', '2026-11-03'],
      headcount: [
        { costCenter: 'CC-WELD', date: '2026-11-02', shift: 1, operators: 3 },
        { costCenter: 'CC-WELD', date: '2026-11-03', shift: 1, operators: 3 },
      ],
    })
    const day2 = allocateOperators(input).decisions[1]
    // L1 (300 dk) bir vardiyada (450 dk) bitti; L4 artık sığar.
    expect(day2.open).toEqual(['L3', 'L2', 'L4'])
  })

  it('work due after this week is not a balance (the line does not produce next week early)', () => {
    expect(weekEndOf('2026-11-02')).toBe('2026-11-08')
    const input = base({ workload: [{ press: 'L1', minutes: 300, dueDate: '2026-11-10' }] })
    const { decisions } = allocateOperators(input)
    expect(decisions[0].open).toEqual([])
    expect(decisions[0].idle).toBe(3)
  })

  it('a skipped date (holiday) is left to the calendar', () => {
    expect(allocateOperators(base({ skipDate: () => true })).dayShifts).toEqual([])
  })
})
