import { describe, expect, it } from 'vitest'

import { planMove, reflowSegments, segmentsOverlap } from './jobMove'

const days = [
  { date: '2026-10-22', capacityMinutes: 1350 },
  { date: '2026-10-23', capacityMinutes: 0 }, // tatil
  { date: '2026-10-24', capacityMinutes: 1350 },
]

describe('reflowSegments', () => {
  it('parçaları sırası ve süresiyle döker; gün dolunca ertesi çalışma gününe geçer', () => {
    const moved = reflowSegments(
      [
        { kind: 'setup', date: '2026-10-20', start: 100, end: 220 },
        { kind: 'run', date: '2026-10-20', start: 220, end: 820 },
      ],
      days,
      '2026-10-22',
      1200,
    )
    expect(moved?.segments).toEqual([
      { kind: 'setup', date: '2026-10-22', start: 1200, end: 1320 },
      { kind: 'run', date: '2026-10-22', start: 1320, end: 1350 },
      { kind: 'run', date: '2026-10-24', start: 0, end: 570 },
    ])
    expect(moved).toMatchObject({ date: '2026-10-22', endDate: '2026-10-24', setupStartMinute: 1200, endMinute: 570 })
  })

  it('günlere bölünmüş eski parçaları birleştirir', () => {
    const moved = reflowSegments(
      [
        { kind: 'run', date: '2026-10-20', start: 1300, end: 1350 },
        { kind: 'run', date: '2026-10-21', start: 0, end: 50 },
      ],
      days,
      '2026-10-22',
      0,
    )
    expect(moved?.segments).toEqual([{ kind: 'run', date: '2026-10-22', start: 0, end: 100 }])
  })

  it('ufka sığmazsa ya da gün yoksa null', () => {
    expect(reflowSegments([{ kind: 'run', date: 'x', start: 0, end: 5000 }], days, '2026-10-22', 0)).toBeNull()
    expect(reflowSegments([{ kind: 'run', date: 'x', start: 0, end: 10 }], days, '2026-11-01', 0)).toBeNull()
  })
})

describe('segmentsOverlap', () => {
  it('aynı gün kesişen dakikalar çakışır; uç uca değmek çakışmaz', () => {
    const a = [{ kind: 'run', date: 'd', start: 0, end: 100 }]
    expect(segmentsOverlap(a, [{ kind: 'run', date: 'd', start: 99, end: 200 }])).toBe(true)
    expect(segmentsOverlap(a, [{ kind: 'run', date: 'd', start: 100, end: 200 }])).toBe(false)
    expect(segmentsOverlap(a, [{ kind: 'run', date: 'e', start: 0, end: 100 }])).toBe(false)
  })
})

describe('planMove', () => {
  const base = {
    segments: [{ kind: 'setup', date: '2026-10-21', start: 0, end: 60 }, { kind: 'run', date: '2026-10-21', start: 60, end: 240 }],
    days: [{ date: '2026-10-22', capacityMinutes: 1440 }],
    dayShape: { shifts: 3 },
    shiftStartMinute: 420,
    shiftMinutes: 480,
    stops: [],
    now: { date: '2026-10-22', clockMinute: 600 },
    fixedOnTarget: [],
  }

  it('saati net dakikaya çevirir: 07:00 vardiya başı, molasız günde 10:00 → net 180', () => {
    const r = planMove({ ...base, target: { press: 'PRS104', date: '2026-10-22', clockMinute: 600 } })
    expect('moved' in r && r.moved.segments).toEqual([
      { kind: 'setup', date: '2026-10-22', start: 180, end: 240 },
      { kind: 'run', date: '2026-10-22', start: 240, end: 420 },
    ])
  })

  it('geçmişe taşınmaz', () => {
    const r = planMove({ ...base, target: { press: 'PRS104', date: '2026-10-22', clockMinute: 540 } })
    expect('error' in r && r.error).toMatch(/past/)
  })

  it('kilitli işle çakışırsa reddeder', () => {
    const r = planMove({
      ...base,
      target: { press: 'PRS104', date: '2026-10-22', clockMinute: 600 },
      fixedOnTarget: [[{ kind: 'run', date: '2026-10-22', start: 400, end: 500 }]],
    })
    expect('error' in r && r.error).toMatch(/Overlaps/)
  })
})
