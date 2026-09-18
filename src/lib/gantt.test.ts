import { describe, expect, it } from 'vitest'

import {
  breakBlocks,
  formatClockMinute,
  netMinuteToClock,
  netShiftMinutes,
  overlappingSetups,
  pressDayBlocks,
  toClockBlocks,
  type GanttBlock,
  type ShiftLayout,
} from './gantt'

// 08:00 start, 8-hour shifts, 30-minute break => 450 productive minutes/shift.
const layout: ShiftLayout = {
  shiftStartMinute: 480,
  shiftMinutes: 480,
  breakMinutesPerShift: 30,
}

const noBreak: ShiftLayout = { ...layout, breakMinutesPerShift: 0 }

describe('netMinuteToClock', () => {
  it('maps the first productive minute to the shift start', () => {
    expect(netMinuteToClock(0, layout)).toBe(480) // 08:00
  })

  it('maps within the first shift one-to-one', () => {
    expect(netMinuteToClock(60, layout)).toBe(540) // 09:00
  })

  it('skips the break when crossing into the second shift', () => {
    expect(netShiftMinutes(layout)).toBe(450)
    // Net minute 450 is the first minute of shift 2, which starts at 16:00.
    expect(netMinuteToClock(450, layout)).toBe(960)
  })

  it('is a straight offset when there is no break', () => {
    expect(netMinuteToClock(480, noBreak)).toBe(960)
  })
})

describe('toClockBlocks', () => {
  it('returns one block for work inside a single shift', () => {
    const blocks = toClockBlocks(0, 120, 'run', layout, 'PRS-1', 'A')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'run', startMinute: 480, endMinute: 600 })
  })

  it('splits work that runs across a break into two blocks', () => {
    // 400 → 500 spans the end of shift 1 (450) into shift 2.
    const blocks = toClockBlocks(400, 500, 'run', layout, 'PRS-1', 'A')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ startMinute: 880, endMinute: 930 }) // up to 15:30
    expect(blocks[1]).toMatchObject({ startMinute: 960, endMinute: 1010 }) // resumes 16:00
  })

  it('does not roll a block ending exactly on the boundary into the next shift', () => {
    const blocks = toClockBlocks(400, 450, 'run', layout, 'PRS-1', 'A')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].endMinute).toBe(930)
  })

  it('returns nothing for an empty interval', () => {
    expect(toClockBlocks(100, 100, 'setup', layout, 'PRS-1')).toEqual([])
    expect(toClockBlocks(100, 50, 'setup', layout, 'PRS-1')).toEqual([])
  })
})

describe('breakBlocks', () => {
  it('places one break at the end of each shift the day reaches', () => {
    const blocks = breakBlocks(900, layout, 'PRS-1') // two full shifts
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'break', startMinute: 930, endMinute: 960 })
    expect(blocks[1]).toMatchObject({ startMinute: 1410, endMinute: 1440 })
  })

  it('produces nothing when no break is configured', () => {
    expect(breakBlocks(900, noBreak, 'PRS-1')).toEqual([])
  })

  it('produces nothing for a day with no capacity', () => {
    expect(breakBlocks(0, layout, 'PRS-1')).toEqual([])
  })
})

describe('pressDayBlocks', () => {
  it('emits a setup block then a run block per job, sorted by time', () => {
    const blocks = pressDayBlocks(
      [{ press: 'PRS-1', material: 'A', setupStartMinute: 0, setupEndMinute: 30, endMinute: 150 }],
      450,
      layout,
      'PRS-1',
    )
    const kinds = blocks.map((b) => b.kind)
    expect(kinds.slice(0, 2)).toEqual(['setup', 'run'])
    expect(blocks[0]).toMatchObject({ startMinute: 480, endMinute: 510, material: 'A' })
    expect(blocks[1]).toMatchObject({ startMinute: 510, endMinute: 630 })
    // The shift break is included as its own block.
    expect(blocks.some((b) => b.kind === 'break')).toBe(true)
    expect(blocks).toEqual([...blocks].sort((a, b) => a.startMinute - b.startMinute))
  })
})

describe('overlappingSetups', () => {
  const block = (
    press: string,
    hall: string,
    startMinute: number,
    endMinute: number,
  ): GanttBlock & { hall: string } => ({
    kind: 'setup',
    press,
    hall,
    startMinute,
    endMinute,
  })

  it('reports two setups overlapping in the same hall', () => {
    const clashes = overlappingSetups([
      block('PRS-1', 'Hall 1', 480, 510),
      block('PRS-2', 'Hall 1', 500, 530),
    ])
    expect(clashes).toHaveLength(1)
    expect(clashes[0].hall).toBe('Hall 1')
  })

  it('allows the same clock window in different halls', () => {
    expect(
      overlappingSetups([
        block('PRS-1', 'Hall 1', 480, 510),
        block('PRS-2', 'Hall 2', 480, 510),
      ]),
    ).toEqual([])
  })

  it('allows back-to-back setups that only touch', () => {
    expect(
      overlappingSetups([
        block('PRS-1', 'Hall 1', 480, 510),
        block('PRS-2', 'Hall 1', 510, 540),
      ]),
    ).toEqual([])
  })

  it('ignores consecutive setups on the same press', () => {
    expect(
      overlappingSetups([
        block('PRS-1', 'Hall 1', 480, 540),
        block('PRS-1', 'Hall 1', 500, 520),
      ]),
    ).toEqual([])
  })
})

describe('formatClockMinute', () => {
  it('formats within the day', () => {
    expect(formatClockMinute(480)).toBe('08:00')
    expect(formatClockMinute(930)).toBe('15:30')
  })

  it('wraps past midnight', () => {
    expect(formatClockMinute(1500)).toBe('01:00')
  })
})
