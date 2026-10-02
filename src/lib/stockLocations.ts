/**
 * Hangi depodaki stok neye sayılır — Storage Locations sayfasındaki matris.
 *
 * Her depo için üç tik vardır: bitmiş ürün (plan ve MRP netleştirmesi),
 * hammadde (bobin, MRP'de eldeki stok) ve üretim girişi (MB51). Kodda
 * fabrikaya özel depo yoktur (docs/plant-genisletme.md, aşama 5): tik
 * verilmemiş depo sayılmaz; hiçbir depo tikli değilse plan uyarır. Eski
 * "Raw Material" kategorisindeki depo hammaddeye sayılır.
 */

export type LocationFlags = {
  code: string
  category?: string
  countFinished?: boolean
  countRaw?: boolean
  /** MB51: bu depoya yapılan 101/102 hareketleri üretimdir. */
  countProduction?: boolean
}

export function countsFinished(l: LocationFlags): boolean {
  return l.countFinished === true
}

export function countsRaw(l: LocationFlags): boolean {
  return l.countRaw ?? l.category === 'raw_material'
}

export function countsProduction(l: LocationFlags): boolean {
  return l.countProduction === true
}

export type CountedLocations = { finished: Set<string>; raw: Set<string>; production: Set<string> }

export function countedLocations(locations: readonly LocationFlags[]): CountedLocations {
  const finished = new Set<string>()
  const raw = new Set<string>()
  const production = new Set<string>()
  for (const l of locations) {
    const code = l.code.trim()
    if (!code) continue
    if (countsFinished(l)) finished.add(code)
    if (countsRaw(l)) raw.add(code)
    if (countsProduction(l)) production.add(code)
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
 * yapılan 101 (giriş, +) ve 102 (iptal, −) hareketleri.
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
