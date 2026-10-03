import { beforeEach, describe, expect, it } from 'vitest'

import { MAX_REPORTS_PER_PAGE, resetReportCount, shouldReport } from './errorReport'

describe('ekran hata kaydı', () => {
  beforeEach(() => resetReportCount())

  it('tarayıcı gürültüsü ve ağ kopması gönderilmez', () => {
    expect(shouldReport('ResizeObserver loop limit exceeded')).toBe(false)
    expect(shouldReport('Script error.')).toBe(false)
    expect(shouldReport('TypeError: Failed to fetch')).toBe(false)
    expect(shouldReport('')).toBe(false)
    expect(shouldReport('[CONVEX M(presses:upsert)] Uncaught ConvexError: Choose the cost center')).toBe(false)
    expect(shouldReport("Cannot read properties of undefined (reading 'name')")).toBe(true)
  })

  it(`sayfa başına en çok ${MAX_REPORTS_PER_PAGE} gönderim`, () => {
    for (let i = 0; i < MAX_REPORTS_PER_PAGE; i++) expect(shouldReport(`e${i}`)).toBe(true)
    expect(shouldReport('one more')).toBe(false)
  })
})
