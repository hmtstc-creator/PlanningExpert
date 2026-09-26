import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import { buildDraftEml, buildOrderWorkbook, parseAddresses, workbookBytes, XLSX_TYPE } from './rawOrderExport'
import { rawMrp } from './rawMrp'

const weeks = [
  { start: '2026-09-21', label: '2026-W39' },
  { start: '2026-09-28', label: '2026-W40' },
]

describe('raw material order export', () => {
  const results = [
    rawMrp({ rawMaterial: 'R1', materials: ['A'], stockKg: 0, needKg: [7000, 7000] }, { coverageDays: 10, extraKg: 500 }),
    rawMrp({ rawMaterial: 'R2', materials: ['B'], stockKg: 99999, needKg: [100, 100] }, { coverageDays: 10, extraKg: 500 }),
  ]

  it('writes an Excel workbook with the order table and the weekly detail', () => {
    const book = buildOrderWorkbook(results, weeks, { computedAt: '26 Sep 2026', coverageDays: 10, extraKg: 500 })
    const back = XLSX.read(workbookBytes(book), { type: 'array' })
    expect(back.SheetNames).toEqual(['Orders', 'Weekly detail'])
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(back.Sheets.Orders, { header: 1 })
    // Yalnızca siparişi olan hammadde (R2 yok) + toplam satırı.
    expect(rows[4][0]).toBe('R1')
    // Sütun 3 yoldaki; hafta 1: 7 000 + sonraki haftanın 7 000 emniyeti + 500.
    expect(rows[4][4]).toBe(14500)
    expect(rows[5][0]).toBe('Total')
  })

  it('builds an unsent Outlook draft with To, Cc, subject and the Excel attached', () => {
    const eml = buildDraftEml({
      to: ['buyer@plant.com'],
      cc: ['boss@plant.com', 'plan@plant.com'],
      subject: 'Hammadde siparişi W39',
      body: 'Ekte sipariş tablosu.',
      attachment: { name: 'orders.xlsx', bytes: new Uint8Array([1, 2, 3]), contentType: XLSX_TYPE },
    })
    expect(eml).toContain('To: buyer@plant.com\r\n')
    expect(eml).toContain('Cc: boss@plant.com, plan@plant.com\r\n')
    expect(eml).toContain('X-Unsent: 1')
    expect(eml).toContain('Subject: =?UTF-8?B?')
    expect(eml).toContain('filename="orders.xlsx"')
    expect(eml).toContain('AQID') // [1,2,3] base64
  })

  it('reads an address list typed any way', () => {
    expect(parseAddresses('a@x.com; B@x.com,\n c@x.com  a@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })
})
