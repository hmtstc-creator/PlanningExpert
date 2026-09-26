import { describe, expect, it } from 'vitest'

import { dataCoverageOf, type PlanInputs } from './planPipeline'
import { prefilterRows } from './sapUploads'
import { normalizeMaterialCode } from './uploadFilter'

describe('upload filter: master data is the main list', () => {
  const codes = { materials: ['12345', 'A-1', 'CO-7'], locations: ['2009', '1009', '9000'], rawMaterials: ['RAW-1'] }

  it('keeps only master data parts (and co-products) in ZPP', () => {
    const rows = [{ material: '12345' }, { material: 'CO-7' }, { material: 'OTHER' }]
    const { kept, report } = prefilterRows('weeklyDemand', rows, codes)
    expect(kept.map((r) => r.material)).toEqual(['12345', 'CO-7'])
    expect(report.skippedUnknownMaterial).toBe(1)
  })

  it('matches SAP codes with leading zeros or other case and stores the master data code', () => {
    const rows = [{ material: '000012345' }, { material: 'a-1' }, { material: '12345.0' }]
    const { kept } = prefilterRows('dailyDemand', rows, codes)
    expect(kept.map((r) => r.material)).toEqual(['12345', 'A-1', '12345'])
  })

  it('keeps raw material (coil) stock in MB52 but not in ZPP', () => {
    const rows = [{ material: 'RAW-1', storageLocation: '9000' }]
    expect(prefilterRows('stock', rows, codes).kept).toHaveLength(1)
    expect(prefilterRows('weeklyDemand', rows, codes).kept).toHaveLength(0)
  })

  it('normalises only what is safe', () => {
    expect(normalizeMaterialCode(' 0001200 ')).toBe('1200')
    expect(normalizeMaterialCode('0')).toBe('0')
    expect(normalizeMaterialCode('0A12')).toBe('0A12')
  })
})

describe('master data coverage alarm', () => {
  const base = {
    products: [{ code: 'A' }, { code: 'B' }, { code: 'C' }],
    weeklyDemand: [{ material: 'A', overdue: 0, periods: [] }],
    dailyDemand: [] as { material: string; periods: { label: string; qty: number }[] }[],
    stock: [{ material: 'B', storageLocation: '2009', unrestricted: 5 }],
  } as unknown as PlanInputs

  it('lists parts missing from each uploaded file and from all of them', () => {
    const c = dataCoverageOf(base)
    expect(c.materials).toBe(3)
    expect(c.files.weeklyDemand.missing).toEqual(['B', 'C'])
    expect(c.files.stock.missing).toEqual(['A', 'C'])
    // ZPP_DAILY yüklenmedi: eksik sayılmaz.
    expect(c.files.dailyDemand).toEqual({ uploaded: false, missingCount: 0, missing: [] })
    expect(c.missingEverywhere).toEqual(['C'])
  })

  it('checks the raw material codes of master data in MB52 too', () => {
    const c = dataCoverageOf({
      ...base,
      products: [{ code: 'A', rawMaterialCode: 'RAW-1' }, { code: 'B', rawMaterialCode: 'RAW-2' }],
      stock: [...base.stock, { material: 'RAW-1', storageLocation: 'X', unrestricted: 900 }],
    } as unknown as PlanInputs)
    expect(c.files.rawStock.missing).toEqual(['RAW-2'])
  })
})

describe('raw material stock', () => {
  it('keeps master data raw codes from any storage location, even an undefined one', () => {
    const codes = { materials: ['A'], locations: ['2009'], rawMaterials: ['RAW-1'] }
    const rows = [
      { material: 'RAW-1', storageLocation: 'R999' },
      { material: 'A', storageLocation: 'R999' },
      { material: 'RAW-9', storageLocation: '2009' },
    ]
    expect(prefilterRows('stock', rows, codes).kept.map((r) => r.material)).toEqual(['RAW-1'])
  })
})
