import { describe, expect, it } from 'vitest'

import { countedLocations, isFinishedStockRow, isRawStockRow } from './stockLocations'

describe('storage location matrix', () => {
  it('defaults: 2009 and 1009 count for both, a Raw Material location for raw material', () => {
    const c = countedLocations([
      { code: '2009', category: 'finished_goods' },
      { code: '3001', category: 'raw_material' },
      { code: '4000', category: 'quality' },
    ])
    expect([...c.finished].sort()).toEqual(['1009', '2009'])
    expect([...c.raw].sort()).toEqual(['1009', '2009', '3001'])
  })

  it('ticks override the defaults', () => {
    const c = countedLocations([
      { code: '1009', category: 'finished_goods', countFinished: true, countRaw: false },
      { code: '2009', category: 'finished_goods', countFinished: false, countRaw: true },
      { code: '5000', category: 'quality', countFinished: true },
    ])
    expect(isFinishedStockRow(c, '1009')).toBe(true)
    expect(isRawStockRow(c, '1009')).toBe(false)
    expect(isFinishedStockRow(c, '2009')).toBe(false)
    expect(isRawStockRow(c, '2009')).toBe(true)
    expect(isFinishedStockRow(c, '5000')).toBe(true)
    // Deposuz satır (eski/elle veri) sayılır.
    expect(isFinishedStockRow(c, undefined)).toBe(true)
  })
})
