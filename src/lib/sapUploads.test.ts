import { describe, expect, it } from 'vitest'

import {
  demandCoverage,
  formatPlantTime,
  planUsage,
  postingCoverage,
  uploadInBatches,
  type BatchUploadApi,
  type SapUpload,
} from './sapUploads'

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

function fakeApi(opts: { failOnBatch?: number; pruneFails?: boolean } = {}) {
  const log: string[] = []
  let batch = 0
  const api: BatchUploadApi = {
    begin: async () => {
      log.push('begin')
      return { uploadedAt: 42, batchSize: 2 }
    },
    append: async ({ rows }) => {
      batch++
      if (batch === opts.failOnBatch) throw new Error('Server Error')
      log.push(`append ${rows.length}`)
      return {
        count: rows.length - 1,
        skippedUnknownMaterial: 1,
        skippedUnknownLocation: 0,
        unknownMaterials: [`X${batch}`],
        unknownLocations: [],
      }
    },
    finish: async (args) => {
      log.push(`finish ${args.rowsInFile}/${args.rowsImported} ${args.fileName}`)
    },
    prune: async () => {
      if (opts.pruneFails) throw new Error('prune failed')
      log.push('prune')
      return { done: true }
    },
  }
  return { api, log }
}

describe('uploadInBatches', () => {
  it('writes in batches, then applies the file, then removes the old rows', async () => {
    const { api, log } = fakeApi()
    const report = await uploadInBatches(api, { key: 'actuals', rows: [1, 2, 3, 4, 5], fileName: 'MB51.xlsx' })
    expect(log).toEqual(['begin', 'append 2', 'append 2', 'append 1', 'finish 5/2 MB51.xlsx', 'prune'])
    expect(report).toEqual({
      count: 2,
      skippedUnknownMaterial: 3,
      skippedUnknownLocation: 0,
      unknownMaterials: ['X1', 'X2', 'X3'],
      unknownLocations: [],
    })
  })

  it('never applies a file whose batches did not all arrive', async () => {
    const { api, log } = fakeApi({ failOnBatch: 2 })
    await expect(uploadInBatches(api, { key: 'actuals', rows: [1, 2, 3, 4, 5] })).rejects.toThrow('Server Error')
    expect(log.some((l) => l.startsWith('finish'))).toBe(false)
  })

  it('does not fail a saved upload because clean-up failed', async () => {
    const { api } = fakeApi({ pruneFails: true })
    await expect(uploadInBatches(api, { key: 'stock', rows: [1, 2] })).resolves.toMatchObject({ count: 1 })
  })
})
