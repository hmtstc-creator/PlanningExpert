import { describe, expect, it } from 'vitest'

import { friendlyError } from './mutationErrors'

describe('friendlyError', () => {
  it('shows the rule message of a ConvexError, not the technical prefix', () => {
    const e = Object.assign(new Error('[CONVEX M(overtime:addPressOvertime)] [Request ID: x] Server Error'), {
      data: 'Full overtime is already open on 2026-09-19 for PRS-106.',
    })
    expect(friendlyError(e)).toEqual({ message: 'Full overtime is already open on 2026-09-19 for PRS-106.', kind: 'rule' })
  })

  it('extracts the message after "Uncaught Error"', () => {
    const e = new Error(
      '[CONVEX M(overtime:addPressOvertime)] [Request ID: abc] Server Error\nUncaught ConvexError: Cannot open Full overtime on 2026-09-19 for PRS-106: overlaps another overtime.\n    at handler (../convex/overtime.ts:1:1)\n\n  Called by client',
    )
    expect(friendlyError(e)).toEqual({
      message: 'Cannot open Full overtime on 2026-09-19 for PRS-106: overlaps another overtime.',
      kind: 'rule',
    })
  })

  it('a redacted server error becomes a plain sentence, never the CONVEX text', () => {
    const f = friendlyError(new Error('[CONVEX M(x:y)] [Request ID: 1] Server Error'))
    expect(f.kind).toBe('server')
    expect(f.message).not.toMatch(/CONVEX|Request ID/)
  })
})
