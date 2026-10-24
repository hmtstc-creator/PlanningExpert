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

// ---- Cost center başına depolar ---------------------------------------------

/**
 * Bir cost center'ın depoları (Storage Locations → "Locations per cost
 * center"). Aynı holdingde bir malzeme bir cost center'ın bitmiş ürünü,
 * diğerinin hammaddesi olabilir; hangi depodaki stoğun kime sayılacağı bu
 * yüzden cost center'a göre değişir.
 *
 * - `production` (WIP): üretim girişi deposu. MB51 101/102 buraya üretimdir;
 *   buradaki stok o cost center'ın bitmiş ürün stoğuna da sayılır.
 * - `finished`: bitmiş ürün stoğu (plan ve MRP netleştirmesi).
 * - `raw`: o cost center'ın tükettiği hammadde stoğu (MRP'de eldeki).
 *
 * Ör. 171 ve 173: WIP 2009, hammadde + bitmiş 1009; 172: WIP 2010,
 * hammadde + bitmiş 1009. 172'nin parçasının 2009'daki stoğu sayılmaz.
 */
export type CostCenterLocations = {
  costCenter: string
  production?: readonly string[]
  finished?: readonly string[]
  raw?: readonly string[]
}

const clean = (codes: readonly string[] | undefined) => (codes ?? []).map((c) => c.trim()).filter(Boolean)

/** Bir cost center tanımının sayım kümeleri; WIP bitmiş ürüne de sayılır. */
export function countedForCostCenter(def: CostCenterLocations): CountedLocations {
  const production = new Set(clean(def.production))
  return {
    finished: new Set([...clean(def.finished), ...production]),
    raw: new Set(clean(def.raw)),
    production,
  }
}

export type StockScope = {
  /** Depo matrisinin tikleri — cost center tanımı olmayan malzemeler için. */
  global: CountedLocations
  /** Malzemenin cost center'ı (ana makinesinin work center'ından). */
  costCenterOf: (material: string) => string | undefined
  /** Malzemenin bitmiş ürün / üretim girişi için geçerli kümeler. */
  countedFor: (material: string) => CountedLocations
  /** Bir hammadde kodunun eldeki stoğu hangi depolardan sayılır. */
  rawLocationsFor: (rawCode: string) => Set<string>
  /** Tanımı olan cost center'lar (boş: bugünkü depo tikleri geçerli). */
  defined: Set<string>
  /** Cost center'ın kümeleri; tanımı yoksa depo tikleri. */
  countedForCostCenter: (costCenter: string) => CountedLocations
  /** Herhangi bir malzeme için bitmiş ürün sayılan depolar (ekran ve uyarı). */
  finishedAnywhere: Set<string>
}

/**
 * Stok kapsamı: her malzeme kendi cost center'ının depolarıyla sayılır.
 * Malzemenin cost center'ı ana makinesinin (work center) cost center'ıdır;
 * eş ürün (co-product) aynı preste çıktığı için aynı cost center'dadır.
 * Cost center'ı olmayan ya da cost center'ının depo tanımı olmayan malzeme
 * bugünkü depo tikleriyle sayılır — tanım yoksa davranış değişmez.
 *
 * Hammadde kodu, onu tüketen parçaların cost center'larının hammadde
 * depolarından sayılır (birkaç cost center tüketiyorsa birleşimi; biri
 * tanımsızsa tiklerin hammadde depoları da eklenir).
 */
export function stockScope(input: {
  locations: readonly LocationFlags[]
  costCenterLocations?: readonly CostCenterLocations[]
  presses?: readonly { name: string; costCenter?: string | null }[]
  products?: readonly { code: string; coProduct?: string | null; mainMachine?: string | null; rawMaterialCode?: string | null }[]
}): StockScope {
  const global = countedLocations(input.locations)
  const byCc = new Map<string, CountedLocations>()
  for (const d of input.costCenterLocations ?? []) {
    const cc = d.costCenter.trim()
    if (cc) byCc.set(cc, countedForCostCenter(d))
  }
  const ccOfPress = new Map<string, string>()
  for (const p of input.presses ?? []) {
    const cc = p.costCenter?.trim()
    if (cc) ccOfPress.set(p.name, cc)
  }
  const ccOfMaterial = new Map<string, string>()
  const rawUsers = new Map<string, Set<string | undefined>>()
  for (const p of input.products ?? []) {
    const cc = p.mainMachine ? ccOfPress.get(p.mainMachine.trim()) : undefined
    if (cc) {
      ccOfMaterial.set(p.code.trim(), cc)
      const co = p.coProduct?.trim()
      if (co && !ccOfMaterial.has(co)) ccOfMaterial.set(co, cc)
    }
    const raw = p.rawMaterialCode?.trim()
    if (raw) {
      const users = rawUsers.get(raw) ?? new Set<string | undefined>()
      users.add(cc && byCc.has(cc) ? cc : undefined)
      rawUsers.set(raw, users)
    }
  }
  const costCenterOf = (material: string) => ccOfMaterial.get(material.trim())
  const countedFor = (material: string) => {
    const cc = costCenterOf(material)
    return (cc && byCc.get(cc)) || global
  }
  const rawCache = new Map<string, Set<string>>()
  const rawLocationsFor = (rawCode: string) => {
    const code = rawCode.trim()
    const hit = rawCache.get(code)
    if (hit) return hit
    const out = new Set<string>()
    const users = rawUsers.get(code) ?? new Set<string | undefined>([undefined])
    for (const cc of users) for (const l of (cc ? byCc.get(cc)! : global).raw) out.add(l)
    rawCache.set(code, out)
    return out
  }
  return {
    global,
    costCenterOf,
    countedFor,
    rawLocationsFor,
    defined: new Set(byCc.keys()),
    countedForCostCenter: (cc) => byCc.get(cc.trim()) ?? global,
    finishedAnywhere: new Set([...global.finished, ...[...byCc.values()].flatMap((c) => [...c.finished])]),
  }
}

/** MB52 satırı malzemenin kendi cost center'ında bitmiş ürün stoğuna sayılır mı. */
export function isFinishedStockRowFor(scope: StockScope, material: string, storageLocation: string | undefined): boolean {
  return isFinishedStockRow(scope.countedFor(material), storageLocation)
}

/** MB52 satırı, hammadde kodunu tüketen cost center'ların eldeki stoğuna sayılır mı. */
export function isRawStockRowFor(scope: StockScope, rawCode: string, storageLocation: string | undefined): boolean {
  const loc = storageLocation?.trim()
  return !loc || scope.rawLocationsFor(rawCode).has(loc)
}

/** MB51 üretim satırları; her malzeme kendi cost center'ının WIP deposuyla. */
export function productionRowsFor<T extends { material: string; quantity: number; movementType?: string; storageLocation?: string }>(
  scope: StockScope,
  rows: readonly T[],
): T[] {
  const out: T[] = []
  for (const row of rows) {
    const quantity = productionQuantity(scope.countedFor(row.material), row)
    if (quantity !== null) out.push({ ...row, quantity })
  }
  return out
}
