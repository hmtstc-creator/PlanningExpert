import { describe, expect, it } from 'vitest'

import { countedLocations, isFinishedStockRow, isRawStockRow, productionRows } from './stockLocations'

describe('storage location matrix', () => {
  it('no plant defaults: an unticked location counts for nothing; old Raw Material category counts for raw', () => {
    const c = countedLocations([
      { code: '2009', category: 'finished_goods' },
      { code: '3001', category: 'raw_material' },
      { code: '4000', category: 'quality' },
    ])
    expect([...c.finished]).toEqual([])
    expect([...c.raw]).toEqual(['3001'])
    expect([...c.production]).toEqual([])
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

  it('MB51 production = 101 minus 102 into the production receipt location', () => {
    const c = countedLocations([{ code: '2009', countProduction: true }])
    const rows = productionRows(c, [
      { material: 'A', quantity: 100, movementType: '101', storageLocation: '2009' },
      { material: 'A', quantity: -30, movementType: '102', storageLocation: '2009' },
      { material: 'A', quantity: 50, movementType: '311', storageLocation: '2009' },
      { material: 'A', quantity: 70, movementType: '101', storageLocation: '1009' },
    ])
    expect(rows.map((r) => r.quantity)).toEqual([100, -30])
    const ticked = countedLocations([{ code: '1009', countProduction: true }])
    expect(productionRows(ticked, [{ quantity: 70, movementType: '101', storageLocation: '1009' }])).toHaveLength(1)
  })
})
