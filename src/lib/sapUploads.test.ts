import { describe, expect, it } from 'vitest'

import { demandCoverage, formatPlantTime, planUsage, postingCoverage, type SapUpload } from './sapUploads'

const upload: SapUpload = { key: 'stock', uploadedAt: 1_000, fileName: 'MB52.xlsx' }

describe('planUsage', () => {
  it('is in the plan when the plan recorded this exact upload', () => {
    const plan = { computedAt: 2_000, dataSources: { stock: { uploadedAt: 1_000 } } }
    expect(planUsage(upload, plan, false)).toEqual({ kind: 'inPlan', computedAt: 2_000 })
  })

  it('is not in the plan when the plan used an older upload, even if computed later', () => {
    const plan = { computedAt: 5_000, dataSources: { stock: { uploadedAt: 500 } } }
    expect(planUsage(upload, plan, true).kind).toBe('recalculating')
    expect(planUsage(upload, plan, false).kind).toBe('notYet')
  })

  it('falls back to the calculation time for plans without a source list', () => {
    expect(planUsage(upload, { computedAt: 2_000 }, false).kind).toBe('inPlan')
    expect(planUsage(upload, { computedAt: 500 }, true).kind).toBe('recalculating')
  })

  it('is not in the plan when the plan has sources but none for this data', () => {
    expect(planUsage(upload, { computedAt: 2_000, dataSources: {} }, false).kind).toBe('notYet')
  })

  it('reports no upload and no plan', () => {
    expect(planUsage(undefined, { computedAt: 1 }, false).kind).toBe('none')
    expect(planUsage(upload, null, true).kind).toBe('recalculating')
  })
})

describe('coverage', () => {
  it('takes the first and last period column of the demand file', () => {
    const rows = [
      { periods: [] },
      { periods: [{ label: '2026-W39' }, { label: '2026-W40' }, { label: '2026-W52' }] },
    ]
    expect(demandCoverage(rows)).toEqual({ coversFrom: '2026-W39', coversTo: '2026-W52' })
    expect(demandCoverage([])).toEqual({})
  })

  it('takes the oldest and newest posting date, ignoring blanks', () => {
    const rows = [{ postingDate: '2026-09-10' }, { postingDate: '' }, { postingDate: '2026-08-01' }, { postingDate: '2026-09-24' }]
    expect(postingCoverage(rows)).toEqual({ coversFrom: '2026-08-01', coversTo: '2026-09-24' })
  })
})

describe('formatPlantTime', () => {
  it('shows Romania time, not the server or browser zone', () => {
    // 2026-09-25 09:30 UTC = 12:30 in Bucharest (summer time, UTC+3)
    expect(formatPlantTime(Date.UTC(2026, 8, 25, 9, 30))).toContain('12:30')
  })
})
