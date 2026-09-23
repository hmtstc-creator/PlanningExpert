import { describe, expect, it } from 'vitest'

import { parseDemandRows, parseMovementRows, parseSapDate, parseStockRows } from './sapParsers'

describe('SAP parsers', () => {
  it('reads ZPP rows with one column per period', () => {
    const rows = parseDemandRows([
      { Material: ' M1 ', 'Stock in storage': 10, 'Overdue Requirements': -5, W38: -100, W39: 0 },
      { Material: '', W38: 3 },
    ])
    expect(rows).toEqual([
      {
        material: 'M1',
        stockInStorage: 10,
        overdue: -5,
        periods: [
          { label: 'W38', qty: -100 },
          { label: 'W39', qty: 0 },
        ],
      },
    ])
  })

  it('reads MB52 stock and drops rows without a material', () => {
    const rows = parseStockRows([
      { Material: 'M1', 'Storage Location': 'FG01', Unrestricted: '12' },
      { Material: '  ' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ material: 'M1', storageLocation: 'FG01', unrestricted: 12 })
  })

  it('reads MB51 movements with Turkish headers and European numbers', () => {
    const rows = parseMovementRows([
      { Malzeme: 'M1', 'Kayıt Tarihi': '03.09.2026', Miktar: '1.250,5', 'Hareket Türü': '101' },
    ])
    expect(rows[0]).toMatchObject({
      material: 'M1',
      postingDate: '2026-09-03',
      quantity: 1250.5,
      movementType: '101',
    })
  })

  it('understands Excel serial dates', () => {
    expect(parseSapDate(46268)).toBe('2026-09-03')
  })
})
