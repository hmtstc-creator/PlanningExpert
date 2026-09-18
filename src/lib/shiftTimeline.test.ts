import { describe, expect, it } from 'vitest'

import {
  buildDayTimeline,
  clockToNet,
  netIntervalToClockBlocks,
  netToClock,
  productionDayOf,
  remainingCapacityMinutes,
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

describe('üç vardiya düzeni: 07:00 – 15:00 – 23:00 – 07:00', () => {
  const shiftStart = 7 * 60 // 07:00
  const shiftLength = 8 * 60

  const threeShiftStops: PlannedStop[] = [
    { shiftIndex: 1, name: 'Handover', kind: 'handover', startMinute: 420, durationMinutes: 15 },
    { shiftIndex: 2, name: 'Handover', kind: 'handover', startMinute: 900, durationMinutes: 15 },
    { shiftIndex: 3, name: 'Handover', kind: 'handover', startMinute: 1380, durationMinutes: 15 },
    { shiftIndex: 3, name: 'Tea', kind: 'tea', startMinute: 180, durationMinutes: 20 },
  ]

  it('üç vardiyayı 07:00den 07:00e kesintisiz döşer', () => {
    const t = buildDayTimeline(shiftStart, shiftLength, 3, [])
    expect(t.shiftStarts).toEqual([420, 900, 1380])
    // Son vardiya ertesi sabah 07:00de biter: 1380 + 480 = 1860.
    expect(t.segments[t.segments.length - 1].end).toBe(1860)
    expect(t.netMinutes).toBe(1440)
  })

  it('gece yarısını aşan vardiyadaki duruşu doğru güne taşır', () => {
    const t = buildDayTimeline(shiftStart, shiftLength, 3, threeShiftStops)
    const tea = t.stops.find((s) => s.name === 'Tea')!
    // 03:00 girildi; üçüncü vardiya penceresinde ertesi güne denk gelir.
    expect(tea.start).toBe(180 + 1440)
    expect(t.netMinutes).toBe(1440 - 15 * 3 - 20)
  })

  it('her vardiya devri kendi vardiyasının başına oturur', () => {
    const t = buildDayTimeline(shiftStart, shiftLength, 3, threeShiftStops)
    const handovers = t.stops.filter((s) => s.kind === 'handover').map((s) => s.start)
    expect(handovers).toEqual([420, 900, 1380])
    // Üretim 07:00da değil, devir bitince 07:15te başlar.
    expect(netToClock(0, t)).toBe(435)
  })
})

describe('productionDayOf', () => {
  const shiftStart = 7 * 60

  it('vardiya başlangıcından sonra bugünü verir', () => {
    const at = new Date(2026, 8, 18, 9, 30)
    expect(productionDayOf(at, shiftStart)).toEqual({ date: '2026-09-18', clockMinute: 570 })
  })

  it('gece yarısından sonra hâlâ önceki günün vardiyasındadır', () => {
    // Salı 02:00: saha Pazartesinin üçüncü vardiyasını çalışıyor.
    const at = new Date(2026, 8, 22, 2, 0)
    expect(productionDayOf(at, shiftStart)).toEqual({ date: '2026-09-21', clockMinute: 120 + 1440 })
  })

  it('vardiya başlangıcında günü devreder', () => {
    const at = new Date(2026, 8, 22, 7, 0)
    expect(productionDayOf(at, shiftStart)).toEqual({ date: '2026-09-22', clockMinute: 420 })
  })
})

describe('remainingCapacityMinutes', () => {
  const shiftStart = 7 * 60
  const timeline = buildDayTimeline(shiftStart, 8 * 60, 3, [])

  it('geçmiş güne kapasite vermez', () => {
    expect(remainingCapacityMinutes('2026-09-17', '2026-09-18', 600, 1440, timeline)).toBe(0)
  })

  it('gelecek güne tam kapasite verir', () => {
    expect(remainingCapacityMinutes('2026-09-19', '2026-09-18', 600, 1440, timeline)).toBe(1440)
  })

  it('bugüne yalnızca kalanı verir', () => {
    // 09:00: 07:00den beri 120 dakika üretim geçmiş.
    expect(remainingCapacityMinutes('2026-09-18', '2026-09-18', 540, 1440, timeline)).toBe(1320)
  })

  it('gece yarısını aşan vardiyada kalanı doğru hesaplar', () => {
    // Ertesi sabah 02:00 = plan günü saat 26:00; 19 saat üretim geçmiş.
    expect(remainingCapacityMinutes('2026-09-18', '2026-09-18', 120 + 1440, 1440, timeline)).toBe(
      1440 - 19 * 60,
    )
  })

  it('duruşta geçen süreyi üretim kaybı saymaz', () => {
    const withStops = buildDayTimeline(shiftStart, 8 * 60, 1, [
      { shiftIndex: 1, name: 'Meal', kind: 'meal', startMinute: 660, durationMinutes: 30 },
    ])
    // 11:15 yemek arasının içi: 11:00a kadar 240 dk üretim olmuş, sayaç durur.
    expect(remainingCapacityMinutes('2026-09-18', '2026-09-18', 675, 450, withStops)).toBe(210)
  })
})
