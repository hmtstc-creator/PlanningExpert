// SAP raporlarının (ZPP, ZPP_DAILY, MB52, MB51) Excel satırlarını kayda
// çeviren saf fonksiyonlar. Yüklemeler tek bir sayfada (SAP Data) toplandı;
// ayrıştırma da sayfadan ayrı ve test edilebilir.

const FIXED_DEMAND_KEYS = ['material', 'stock in storage', 'overdue requirements']

/** ZPP / ZPP_DAILY: sabit sütunlar + her dönem için bir sütun. */
export function parseDemandRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      const entries = Object.entries(row)
      const materialEntry = entries.find(([k]) => k.trim().toLowerCase() === 'material')
      const material = materialEntry ? String(materialEntry[1] ?? '').trim() : ''
      const stockEntry = entries.find((e) => e[0].trim().toLowerCase() === 'stock in storage')
      const overdueEntry = entries.find((e) => e[0].trim().toLowerCase() === 'overdue requirements')
      const periods = entries
        .filter(([k]) => !FIXED_DEMAND_KEYS.includes(k.trim().toLowerCase()))
        .map(([label, value]) => ({ label, qty: Number(value) || 0 }))
      return {
        material,
        stockInStorage: stockEntry ? Number(stockEntry[1]) || 0 : undefined,
        overdue: overdueEntry ? Number(overdueEntry[1]) || 0 : undefined,
        periods,
      }
    })
    .filter((r) => r.material)
}

function stockNum(v: unknown) {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
function stockStr(v: unknown) {
  const s = String(v ?? '').trim()
  return s === '' ? undefined : s
}

/** MB52 stok raporu. */
export function parseStockRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => ({
      material: stockStr(row['Material']) ?? '',
      plant: stockStr(row['Plant']),
      storageLocation: stockStr(row['Storage Location']),
      unrestricted: stockNum(row['Unrestricted']),
      qualityInspection: stockNum(row['Quality Inspection']),
      restricted: stockNum(row['Restricted-Use Stock']),
      blocked: stockNum(row['Blocked Stock']),
      returns: stockNum(row['Returns']),
      transit: stockNum(row['Transit and Transfer']),
    }))
    .filter((r) => r.material)
}

const movementStr = (v: unknown) => {
  const t = String(v ?? '').trim()
  return t === '' || t === '#N/A' ? undefined : t
}

const movementNum = (v: unknown) => {
  const t = String(v ?? '').trim().replace(/\./g, '').replace(',', '.')
  if (t === '' || t === '#N/A') return undefined
  const parsed = Number(t)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** MB51'de tarih hem Excel seri numarası hem de metin olarak gelebilir. */
export function parseSapDate(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = (value - 25569) * 86400 * 1000
    return new Date(ms).toISOString().slice(0, 10)
  }
  const t = String(value ?? '').trim()
  if (!t) return ''
  const dotted = t.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/)
  if (dotted) {
    const [, d, m, y] = dotted
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  return ''
}

/** MB51 hareket raporu — İngilizce ve Türkçe sütun adlarını tanır. */
export function parseMovementRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => ({
      material: movementStr(row['Material'] ?? row['Malzeme'] ?? row['material']) ?? '',
      postingDate: parseSapDate(
        row['Posting Date'] ?? row['Pstng Date'] ?? row['Kayıt Tarihi'] ?? row['postingDate'],
      ),
      quantity:
        movementNum(
          row['Quantity'] ?? row['Qty in Un. of Entry'] ?? row['Miktar'] ?? row['quantity'],
        ) ?? 0,
      plant: movementStr(row['Plant'] ?? row['Üretim Yeri'] ?? row['plant']),
      storageLocation: movementStr(
        row['Storage Location'] ?? row['Depo Yeri'] ?? row['storageLocation'],
      ),
      movementType: movementStr(
        row['Movement Type'] ?? row['Movement type'] ?? row['Hareket Türü'] ?? row['movementType'],
      ),
      orderNumber: movementStr(row['Order'] ?? row['Sipariş'] ?? row['orderNumber']),
    }))
    .filter((r) => r.material)
}
