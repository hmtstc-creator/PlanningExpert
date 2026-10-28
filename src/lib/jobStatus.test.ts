import { describe, expect, it } from 'vitest'
import { dottedDate, jobStatus } from './jobStatus'
import type { DemandEntry } from './planning'
import { jobRequirements } from './scheduler'

const req = (qty: number, hours: number) => ({
  date: '2026-10-28', qty, deadlineDate: '2026-10-28', deadlineMinute: 60, readyDate: '2026-10-28', readyMinute: 0, hours,
})

describe('jobStatus', () => {
  it('acil bakiye 2 saat geç, rulo fazlası overstock', () => {
    expect(jobStatus(6000, [req(3000, 2)])).toEqual([
      { qty: 3000, kind: 'late', hours: 2 },
      { qty: 3000, kind: 'overstock' },
    ])
  })
  it('erken ve geç ihtiyaçlar ayrı, aynı durumdakiler birleşir', () => {
    expect(jobStatus(5000, [req(1000, -14), req(1500, -14), req(2500, 3.5)])).toEqual([
      { qty: 2500, kind: 'early', hours: 14 },
      { qty: 2500, kind: 'late', hours: 3.5 },
    ])
  })
  it('ihtiyacı olmayan iş tamamen overstock', () => {
    expect(jobStatus(1200, undefined)).toEqual([{ qty: 1200, kind: 'overstock' }])
  })
  it('tarih biçimi', () => expect(dottedDate('2026-10-28')).toBe('28.10.2026'))
})

describe('jobRequirements', () => {
  it('kontrol noktalarından gün başına adet ve hazır an', () => {
    const entry = {
      checkpoints: [
        { date: '2026-10-28', fraction: 0.5, deadlineDate: '2026-10-28', deadlineNet: 60 },
        { date: '2026-10-29', fraction: 0.75, deadlineDate: '2026-10-29', deadlineNet: 60 },
      ],
    } as unknown as DemandEntry
    const segments = [
      { kind: 'setup', date: '2026-10-28', start: 0, end: 30 },
      { kind: 'run', date: '2026-10-28', start: 30, end: 130 },
    ] as Parameters<typeof jobRequirements>[1]
    expect(jobRequirements(entry, segments, 6000)).toEqual([
      { date: '2026-10-28', qty: 3000, deadlineDate: '2026-10-28', deadlineMinute: 60, readyDate: '2026-10-28', readyMinute: 80 },
      { date: '2026-10-29', qty: 1500, deadlineDate: '2026-10-29', deadlineMinute: 60, readyDate: '2026-10-28', readyMinute: 105 },
    ])
  })
  it('stoğu ufukta bitmeyen lotun ihtiyacı yok', () => {
    expect(jobRequirements({ noStockout: true } as DemandEntry, [], 100)).toEqual([])
  })
})
