/**
 * Hangi depodaki stok neye sayılır — Storage Locations sayfasındaki matris.
 *
 * Her depo için iki tik vardır: bitmiş ürün (plan ve MRP netleştirmesi) ve
 * hammadde (bobin, MRP'de eldeki stok). Tik hiç verilmemişse varsayılan
 * geçerlidir: 2009 ve 1009 her ikisine de sayılır, "Raw Material"
 * kategorisindeki depo hammaddeye sayılır. Tanımlanmamış 2009/1009 da
 * varsayılanla sayılır ki depo listesi boşken plan stoksuz kalmasın.
 */

export const DEFAULT_COUNTED_LOCATIONS = ['2009', '1009'] as const

export type LocationFlags = {
  code: string
  category?: string
  countFinished?: boolean
  countRaw?: boolean
  /** MB51: bu depoya yapılan 101/102 hareketleri üretimdir. */
  countProduction?: boolean
}

const DEFAULTS = new Set<string>(DEFAULT_COUNTED_LOCATIONS)

export function countsFinished(l: LocationFlags): boolean {
  return l.countFinished ?? DEFAULTS.has(l.code.trim())
}

export function countsRaw(l: LocationFlags): boolean {
  return l.countRaw ?? (l.category === 'raw_material' || DEFAULTS.has(l.code.trim()))
}

/** Üretim girişi deposu varsayılanı (MB51 101/102). */
export const DEFAULT_PRODUCTION_LOCATIONS = ['2009'] as const
const PRODUCTION_DEFAULTS = new Set<string>(DEFAULT_PRODUCTION_LOCATIONS)

export function countsProduction(l: LocationFlags): boolean {
  return l.countProduction ?? PRODUCTION_DEFAULTS.has(l.code.trim())
}

export type CountedLocations = { finished: Set<string>; raw: Set<string>; production: Set<string> }

export function countedLocations(locations: readonly LocationFlags[]): CountedLocations {
  const finished = new Set<string>()
  const raw = new Set<string>()
  const production = new Set<string>()
  const defined = new Set<string>()
  for (const l of locations) {
    const code = l.code.trim()
    if (!code) continue
    defined.add(code)
    if (countsFinished(l)) finished.add(code)
    if (countsRaw(l)) raw.add(code)
    if (countsProduction(l)) production.add(code)
  }
  for (const code of PRODUCTION_DEFAULTS) if (!defined.has(code)) production.add(code)
  for (const code of DEFAULTS) {
    if (defined.has(code)) continue
    finished.add(code)
    raw.add(code)
  }
  return { finished, raw, production }
}

/** Bir MB52 satırı bitmiş ürün stoğuna sayılır mı. Deposuz satır (eski/elle veri) sayılır. */
export function isFinishedStockRow(counted: CountedLocations, storageLocation: string | undefined): boolean {
  const loc = storageLocation?.trim()
  return !loc || counted.finished.has(loc)
}

/** Bir MB52 satırı eldeki hammadde stoğuna sayılır mı. Deposuz satır sayılır. */
export function isRawStockRow(counted: CountedLocations, storageLocation: string | undefined): boolean {
  const loc = storageLocation?.trim()
  return !loc || counted.raw.has(loc)
}

/**
 * MB51 satırının üretim adedi: yalnızca "Production receipt" tikli depoya
 * (varsayılan 2009) yapılan 101 (giriş, +) ve 102 (iptal, −) hareketleri.
 * Diğer satırlar üretim değildir (null). Hareket türü sütunu hiç gelmemiş
 * eski yüklemelerde satır olduğu gibi sayılır.
 */
export function productionQuantity(
  counted: CountedLocations,
  row: { quantity: number; movementType?: string; storageLocation?: string },
): number | null {
  const type = row.movementType?.trim()
  if (!type) return row.quantity
  if (type !== '101' && type !== '102') return null
  const loc = row.storageLocation?.trim()
  if (!loc || !counted.production.has(loc)) return null
  const qty = Math.abs(row.quantity)
  return type === '102' ? -qty : qty
}

/** Yalnızca üretim satırları, işaretli adetle (102 eksi). */
export function productionRows<T extends { quantity: number; movementType?: string; storageLocation?: string }>(
  counted: CountedLocations,
  rows: readonly T[],
): T[] {
  const out: T[] = []
  for (const row of rows) {
    const quantity = productionQuantity(counted, row)
    if (quantity !== null) out.push({ ...row, quantity })
  }
  return out
}
