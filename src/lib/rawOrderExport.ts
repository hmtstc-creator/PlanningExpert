// Hammadde sipariş tablosu: Excel (.xlsx) ve Outlook taslağı (.eml).
//
// Şifre gerektirmez: .eml dosyası açılınca Outlook'ta alıcıları, konusu ve
// Excel eki hazır, GÖNDERİLMEMİŞ bir taslak açılır (X-Unsent: 1). Mail
// kullanıcının kendi Outlook'undan, kendi hesabıyla gider.

import * as XLSX from 'xlsx'

import type { MrpWeek, RawMrpResult } from './rawMrp'

export interface OrderExportMeta {
  computedAt: string
  coverageDays: number
  extraKg: number
}

/** Sipariş tablosu (hammadde × teslim haftası) ve haftalık ayrıntı: iki sayfalık çalışma kitabı. */
export function buildOrderWorkbook(results: RawMrpResult[], weeks: MrpWeek[], meta: OrderExportMeta): XLSX.WorkBook {
  const withOrders = results.filter((r) => r.totalOrderKg > 0)
  const totals = weeks.map((_, w) => withOrders.reduce((a, r) => a + r.rows[w].orderKg, 0))
  const orders: (string | number | null)[][] = [
    ['Raw material orders by delivery week (kg)'],
    [`Calculated ${meta.computedAt} · safety stock ${meta.coverageDays} working days · +${meta.extraKg} kg per order`],
    [],
    ['Raw material', 'Used by', 'Stock (kg)', 'In transit (kg)', ...weeks.map((w) => `${w.label} (${w.start})`), 'Total (kg)'],
    ...withOrders.map((r) => [
      r.rawMaterial,
      r.materials.join(', '),
      r.stockKg,
      r.totalInTransitKg > 0 ? r.totalInTransitKg : null,
      ...r.rows.map((row) => (row.orderKg > 0 ? row.orderKg : null)),
      r.totalOrderKg,
    ]),
    ['Total', '', null, null, ...totals.map((t) => (t > 0 ? t : null)), totals.reduce((a, b) => a + b, 0)],
  ]
  const sheet = XLSX.utils.aoa_to_sheet(orders)
  sheet['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 11 }, { wch: 14 }, ...weeks.map(() => ({ wch: 20 })), { wch: 12 }]

  const detail: (string | number)[][] = [
    ['Raw material', 'Week', 'Week start', 'Need (kg)', 'Stock at start (kg)', 'In transit arriving (kg)', 'Safety (kg)', 'Order (kg)', 'Stock at end (kg)'],
  ]
  for (const r of withOrders) {
    r.rows.forEach((row, w) =>
      detail.push([r.rawMaterial, weeks[w].label, weeks[w].start, row.needKg, row.stockStartKg, row.inTransitKg, row.safetyKg, row.orderKg, row.stockEndKg]),
    )
  }
  const detailSheet = XLSX.utils.aoa_to_sheet(detail)
  detailSheet['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 11 }, { wch: 16 }]

  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Orders')
  XLSX.utils.book_append_sheet(book, detailSheet, 'Weekly detail')
  return book
}

export function workbookBytes(book: XLSX.WorkBook): Uint8Array<ArrayBuffer> {
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const utf8 = (text: string) => new TextEncoder().encode(text)
const wrap = (b64: string) => b64.replace(/.{1,76}/g, (line) => `${line}\r\n`)
/** Başlıkta Türkçe karakter: RFC 2047 kodlaması. */
const header = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${toBase64(utf8(text))}?=`)

/**
 * Outlook'ta açılınca gönderilmeye hazır taslak olan bir .eml dosyası.
 */
export function buildDraftEml(input: {
  to: string[]
  cc: string[]
  subject: string
  body: string
  attachment: { name: string; bytes: Uint8Array; contentType: string }
}): string {
  const boundary = `----=_PlanningExpert_${Date.now().toString(36)}`
  const lines = [
    `To: ${input.to.join(', ')}`,
    ...(input.cc.length > 0 ? [`Cc: ${input.cc.join(', ')}`] : []),
    `Subject: ${header(input.subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(toBase64(utf8(input.body))),
    `--${boundary}`,
    `Content-Type: ${input.attachment.contentType}; name="${input.attachment.name}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${input.attachment.name}"`,
    '',
    wrap(toBase64(input.attachment.bytes)),
    `--${boundary}--`,
    '',
  ]
  return lines.join('\r\n')
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Listeden adres ayıklar: virgül, noktalı virgül, boşluk ya da satır sonuyla ayrılmış. */
export function parseAddresses(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)))
}
