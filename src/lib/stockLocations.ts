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
}

const DEFAULTS = new Set<string>(DEFAULT_COUNTED_LOCATIONS)

export function countsFinished(l: LocationFlags): boolean {
  return l.countFinished ?? DEFAULTS.has(l.code.trim())
}

export function countsRaw(l: LocationFlags): boolean {
  return l.countRaw ?? (l.category === 'raw_material' || DEFAULTS.has(l.code.trim()))
}

export type CountedLocations = { finished: Set<string>; raw: Set<string> }

export function countedLocations(locations: readonly LocationFlags[]): CountedLocations {
  const finished = new Set<string>()
  const raw = new Set<string>()
  const defined = new Set<string>()
  for (const l of locations) {
    const code = l.code.trim()
    if (!code) continue
    defined.add(code)
    if (countsFinished(l)) finished.add(code)
    if (countsRaw(l)) raw.add(code)
  }
  for (const code of DEFAULTS) {
    if (defined.has(code)) continue
    finished.add(code)
    raw.add(code)
  }
  return { finished, raw }
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
