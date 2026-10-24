import { describe, expect, it } from 'vitest'

import {
  countedLocations,
  intermediateCodes,
  isFinishedStockRow,
  isFinishedStockRowFor,
  isRawStockRow,
  isRawStockRowFor,
  productionRows,
  productionRowsFor,
  stockScope,
} from './stockLocations'

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

describe('locations per cost center', () => {
  // 171 ve 173: WIP 2009, hammadde + bitmiş 1009; 172: WIP 2010, hammadde + bitmiş 1009.
  const scope = stockScope({
    locations: [
      { code: '1009', countFinished: true, countRaw: true },
      { code: '2009', countFinished: true, countProduction: true },
      { code: '2010', countFinished: true, countProduction: true },
    ],
    costCenterLocations: [
      { costCenter: '171', production: ['2009'], finished: ['1009'], raw: ['1009'] },
      { costCenter: '173', production: ['2009'], finished: ['1009'], raw: ['1009'] },
      { costCenter: '172', production: ['2010'], finished: ['1009'], raw: ['1009'] },
    ],
    presses: [
      { name: 'PRS-171', costCenter: '171' },
      { name: 'PRS-172', costCenter: '172' },
      { name: 'PRS-9', costCenter: '999' },
    ],
    products: [
      // 172'nin bitmiş parçası STAMP-1, 171'in parçası ASSY-1'in hammaddesi.
      { code: 'STAMP-1', mainMachine: 'PRS-172', rawMaterialCode: 'COIL-1' },
      { code: 'ASSY-1', mainMachine: 'PRS-171', rawMaterialCode: 'STAMP-1' },
      { code: 'OTHER', mainMachine: 'PRS-9' },
    ],
  })

  it('a part counts its own cost center: WIP + finished; another WIP does not count', () => {
    expect(isFinishedStockRowFor(scope, 'STAMP-1', '2010')).toBe(true)
    expect(isFinishedStockRowFor(scope, 'STAMP-1', '1009')).toBe(true)
    expect(isFinishedStockRowFor(scope, 'STAMP-1', '2009')).toBe(false)
    expect(isFinishedStockRowFor(scope, 'ASSY-1', '2009')).toBe(true)
    expect(isFinishedStockRowFor(scope, 'ASSY-1', '2010')).toBe(false)
  })

  it('an intermediate (made by 172, consumed by 171) counts once: finished only, never raw', () => {
    // Karar 2026-10-24: 171'in çektiği miktar 172'nin ZPP talebinde zaten var.
    expect(scope.intermediates).toEqual(new Set(['STAMP-1']))
    expect(isFinishedStockRowFor(scope, 'STAMP-1', '1009')).toBe(true)
    expect(isRawStockRowFor(scope, 'STAMP-1', '1009')).toBe(false)
    expect(isRawStockRowFor(scope, 'STAMP-1', undefined)).toBe(false)
    expect(isRawStockRowFor(scope, 'COIL-1', '1009')).toBe(true)
  })

  it('a cost center without a definition uses the location ticks', () => {
    expect(scope.costCenterOf('OTHER')).toBe('999')
    expect(isFinishedStockRowFor(scope, 'OTHER', '2010')).toBe(true)
    expect(isFinishedStockRowFor(scope, 'UNKNOWN', '2009')).toBe(true)
  })

  it('MB51 production is a receipt into the WIP location of the part cost center', () => {
    const rows = productionRowsFor(scope, [
      { material: 'STAMP-1', quantity: 100, movementType: '101', storageLocation: '2010' },
      { material: 'STAMP-1', quantity: 40, movementType: '101', storageLocation: '2009' },
      { material: 'ASSY-1', quantity: 30, movementType: '101', storageLocation: '2009' },
      { material: 'ASSY-1', quantity: 5, movementType: '102', storageLocation: '2009' },
    ])
    expect(rows.map((r) => [r.material, r.quantity])).toEqual([
      ['STAMP-1', 100],
      ['ASSY-1', 30],
      ['ASSY-1', -5],
    ])
  })
})

describe('intermediateCodes', () => {
  it('a raw code made by another card (or its co-product) is an intermediate; a self reference is not', () => {
    expect(
      intermediateCodes([
        { code: 'A', rawMaterialCode: 'B' },
        { code: 'B', coProduct: 'C', rawMaterialCode: 'COIL' },
        { code: 'D', rawMaterialCode: 'C' },
        { code: 'E', rawMaterialCode: 'E' },
      ]),
    ).toEqual(new Set(['B', 'C']))
  })
})
