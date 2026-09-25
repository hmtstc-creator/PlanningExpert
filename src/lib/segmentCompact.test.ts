import { describe, expect, it } from 'vitest'

import { compactSegments } from './segmentCompact'

describe('compactSegments', () => {
  it('leaves ordinary jobs untouched', () => {
    const segs = [{ kind: 'setup', date: 'd1', start: 0, end: 30 }, { kind: 'run', date: 'd1', start: 30, end: 60 }]
    expect(compactSegments(segs)).toBe(segs)
  })

  it('merges thousands of coil pieces into one run per touching stretch', () => {
    const segs = [{ kind: 'setup', date: 'd1', start: 0, end: 30 }]
    let t = 30
    for (let i = 0; i < 6000; i++) {
      segs.push({ kind: 'coil', date: 'd1', start: t, end: t + 0.05 })
      segs.push({ kind: 'run', date: 'd1', start: t + 0.05, end: t + 0.1 })
      t += 0.1
    }
    segs.push({ kind: 'run', date: 'd2', start: 0, end: 100 })
    const out = compactSegments(segs, 100)
    expect(out).toEqual([
      { kind: 'setup', date: 'd1', start: 0, end: 30 },
      { kind: 'run', date: 'd1', start: 30, end: expect.closeTo(630, 3) },
      { kind: 'run', date: 'd2', start: 0, end: 100 },
    ])
  })

  it('falls back to one span per day and never exceeds the limit', () => {
    const segs = Array.from({ length: 50 }, (_, i) => ({ kind: 'run', date: `d${i % 5}`, start: i * 10, end: i * 10 + 5 }))
    const out = compactSegments(segs, 10)
    expect(out).toHaveLength(5)
    expect(out[0]).toMatchObject({ date: 'd0', start: 0, end: 455 })
  })
})
