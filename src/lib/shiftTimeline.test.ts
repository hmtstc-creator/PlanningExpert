import { describe, expect, it } from 'vitest'

import {
  buildDayTimeline,
  clockToNet,
  netIntervalToClockBlocks,
  netToClock,
  stopMinutesInShift,
  type PlannedStop,
} from './shiftTimeline'

// Shift 1 runs 08:00–16:00 with a 15-minute handover at the start and a
// 30-minute meal at 12:00. Productive: 08:15–12:00 and 12:30–16:00 = 435 min.
const stops: PlannedStop[] = [
  { shiftIndex: 1, name: 'Handover', kind: 'handover', startMinute: 480, durationMinutes: 15 },
  { shiftIndex: 1, name: 'Meal', kind: 'meal', startMinute: 720, durationMinutes: 30 },
  { shiftIndex: 2, name: 'Handover', kind: 'handover', startMinute: 960, durationMinutes: 15 },
]

describe('buildDayTimeline', () => {
  it('cuts the stops out of the shift window', () => {
    const t = buildDayTimeline(480, 480, 1, stops)
    expect(t.segments).toEqual([
      { start: 495, end: 720 },
      { start: 750, end: 960 },
    ])
    expect(t.netMinutes).toBe(435)
  })

  it('only counts stops belonging to a shift that runs today', () => {
    const one = buildDayTimeline(480, 480, 1, stops)
    expect(one.stops).toHaveLength(2)
    const two = buildDayTimeline(480, 480, 2, stops)
    expect(two.stops).toHaveLength(3)
  })

  it('places a stop at the very start of a shift', () => {
    const t = buildDayTimeline(480, 480, 1, stops)
    // Production does not begin at 08:00 — the handover comes first.
    expect(t.segments[0].start).toBe(495)
  })

  it('handles a day with no stops at all', () => {
    const t = buildDayTimeline(480, 480, 2, [])
    expect(t.segments).toEqual([{ start: 480, end: 960 }, { start: 960, end: 1440 }])
    expect(t.netMinutes).toBe(960)
  })

  it('resolves a stop whose clock time falls in a shift running past midnight', () => {
    // Shift 3 runs 00:00–08:00 of the next day, i.e. 1440–1920.
    const night: PlannedStop[] = [
      { shiftIndex: 3, name: 'Tea', kind: 'tea', startMinute: 180, durationMinutes: 20 },
    ]
    const t = buildDayTimeline(480, 480, 3, night)
    const tea = t.stops.find((s) => s.name === 'Tea')!
    expect(tea.start).toBe(180 + 1440) // 03:00 next day
  })

  it('clips a stop that would run past the end of its shift', () => {
    const late: PlannedStop[] = [
      { shiftIndex: 1, name: 'Late', kind: 'other', startMinute: 950, durationMinutes: 60 },
    ]
    const t = buildDayTimeline(480, 480, 1, late)
    expect(t.stops[0].end).toBe(960)
  })
})

describe('netToClock / clockToNet', () => {
  const timeline = buildDayTimeline(480, 480, 1, stops)

  it('starts production after the handover, not at the shift start', () => {
    expect(netToClock(0, timeline)).toBe(495) // 08:15
  })

  it('jumps over the meal break', () => {
    // 225 productive minutes reach 12:00; the next minute is 12:30.
    expect(netToClock(224, timeline)).toBe(719)
    expect(netToClock(225, timeline)).toBe(750)
  })

  it('round-trips', () => {
    for (const net of [0, 10, 224, 225, 300, 434]) {
      expect(clockToNet(netToClock(net, timeline), timeline)).toBe(net)
    }
  })

  it('counts no productive time during a stop', () => {
    expect(clockToNet(720, timeline)).toBe(225) // 12:00, meal starts
    expect(clockToNet(735, timeline)).toBe(225) // 12:15, still in the meal
    expect(clockToNet(750, timeline)).toBe(225) // 12:30, production resumes
  })

  it('counts nothing before the shift begins', () => {
    expect(clockToNet(400, timeline)).toBe(0)
    expect(clockToNet(480, timeline)).toBe(0)
  })
})

describe('netIntervalToClockBlocks', () => {
  const timeline = buildDayTimeline(480, 480, 1, stops)

  it('returns one block for work inside a single stretch', () => {
    expect(netIntervalToClockBlocks(0, 60, timeline)).toEqual([{ start: 495, end: 555 }])
  })

  it('splits work that spans the meal break', () => {
    const blocks = netIntervalToClockBlocks(200, 260, timeline)
    expect(blocks).toEqual([
      { start: 695, end: 720 },
      { start: 750, end: 785 },
    ])
  })

  it('returns nothing for an empty interval', () => {
    expect(netIntervalToClockBlocks(50, 50, timeline)).toEqual([])
  })
})

describe('stopMinutesInShift', () => {
  it('adds up the stops in one shift', () => {
    expect(stopMinutesInShift(1, stops)).toBe(45)
    expect(stopMinutesInShift(2, stops)).toBe(15)
    expect(stopMinutesInShift(3, stops)).toBe(0)
  })
})
