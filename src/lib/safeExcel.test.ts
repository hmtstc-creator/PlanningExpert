import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import { MAX_EXCEL_BYTES, checkExcelFile, readWorkbook } from './safeExcel'

describe('safeExcel', () => {
  it('tür ve boyut', () => {
    expect(checkExcelFile({ name: 'zpp.xlsx', size: 1000 })).toBeNull()
    expect(checkExcelFile({ name: 'data.CSV', size: 1000 })).toBeNull()
    expect(checkExcelFile({ name: 'evil.exe', size: 10 })).toContain('Excel')
    expect(checkExcelFile({ name: 'big.xlsx', size: MAX_EXCEL_BYTES + 1 })).toContain('larger')
  })
  it('değerler okunur, formül okunmaz', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Material', 'Qty'], ['A', 5]])
    ws['C2'] = { t: 'n', v: 10, f: 'B2*2' }
    ws['!ref'] = 'A1:C2'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const read = readWorkbook(buf)
    const sheet = read.Sheets.S
    expect(sheet.A2.v).toBe('A')
    expect(sheet.C2.v).toBe(10)
    expect(sheet.C2.f).toBeUndefined()
  })
})
