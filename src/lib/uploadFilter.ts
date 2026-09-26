// Shared import filter for the SAP uploads.
//
// The plant's SAP reports cover far more than this press shop: materials made
// elsewhere and storage locations that are nothing to do with production. Only
// what the user has declared is relevant:
//
//   - a material must exist in master data (products)
//   - for MB52 stock, its storage location must be a defined one
//
// Anything else is dropped at import rather than stored, but the caller is told
// what was dropped so undefined codes can still be discovered and defined.
//
// Pure: the browser runs it before sending (so only relevant rows travel)
// and the server runs it again before writing.

/** How many distinct unknown keys to report back; enough to act on, not a dump. */
const MAX_REPORTED = 25

export interface FilterReport {
  /** Rows written. */
  count: number
  /** Rows dropped because the material is not in master data. */
  skippedUnknownMaterial: number
  /** Rows dropped because the storage location is not defined. */
  skippedUnknownLocation: number
  /** Distinct material codes that were dropped (capped). */
  unknownMaterials: string[]
  /** Distinct storage location codes that were dropped (capped). */
  unknownLocations: string[]
}

/**
 * Malzeme kodunun karşılaştırma biçimi: boşluksuz, büyük harf; yalnızca
 * rakamdan oluşan kodda baştaki sıfırlar ve Excel'in ".0" eki atılır.
 * SAP "000012345" verir, master data'da "12345" yazar — aynı malzemedir.
 */
export function normalizeMaterialCode(code: string): string {
  let c = String(code ?? '').trim().toUpperCase()
  if (/^\d+(\.0+)?$/.test(c)) c = c.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '')
  return c
}

export interface FilterOptions<Row> {
  rows: Row[]
  materialOf: (row: Row) => string
  /**
   * Kod master data'ya yalnızca biçim farkıyla uyuyorsa (baştaki sıfırlar,
   * büyük/küçük harf) satır master data'daki koda çevrilir.
   */
  rename?: (row: Row, material: string) => Row
  /** Omit when the upload has no storage location dimension. */
  locationOf?: (row: Row) => string | undefined
  knownMaterials: Set<string>
  knownLocations?: Set<string>
  /**
   * Bu malzemelerin satırları depo süzgecine takılmaz (ör. master data'daki
   * hammadde kodları: rulo hangi depoda olursa olsun gerekir).
   */
  locationExempt?: Set<string>
}

export interface FilterResult<Row> {
  kept: Row[]
  report: Omit<FilterReport, 'count'>
}

/**
 * Splits rows into the ones worth storing and a report of what was dropped.
 *
 * When master data is empty nothing is filtered on material: a brand-new
 * deployment would otherwise reject every upload with no way to tell why.
 * The same applies to storage locations.
 */
export function filterRows<Row>(options: FilterOptions<Row>): FilterResult<Row> {
  const { rows, materialOf, locationOf, knownMaterials, knownLocations, rename, locationExempt } = options
  const exempt = new Set(Array.from(locationExempt ?? [], (c) => normalizeMaterialCode(c)))
  const checkMaterial = knownMaterials.size > 0
  const canonical = new Map<string, string>()
  for (const code of knownMaterials) canonical.set(normalizeMaterialCode(code), code)
  const checkLocation = !!locationOf && !!knownLocations && knownLocations.size > 0

  const kept: Row[] = []
  const unknownMaterials = new Set<string>()
  const unknownLocations = new Set<string>()
  let skippedUnknownMaterial = 0
  let skippedUnknownLocation = 0

  for (let row of rows) {
    const material = materialOf(row).trim()
    if (!material) continue

    if (checkMaterial && !knownMaterials.has(material)) {
      const match = canonical.get(normalizeMaterialCode(material))
      if (!match) {
        skippedUnknownMaterial++
        if (unknownMaterials.size < MAX_REPORTED) unknownMaterials.add(material)
        continue
      }
      if (rename) row = rename(row, match)
    }
    if (exempt.has(normalizeMaterialCode(material))) {
      kept.push(row)
      continue
    }

    if (checkLocation) {
      const location = locationOf!(row)?.trim() ?? ''
      if (!location || !knownLocations!.has(location)) {
        skippedUnknownLocation++
        if (location && unknownLocations.size < MAX_REPORTED) unknownLocations.add(location)
        continue
      }
    }

    kept.push(row)
  }

  return {
    kept,
    report: {
      skippedUnknownMaterial,
      skippedUnknownLocation,
      unknownMaterials: Array.from(unknownMaterials).sort(),
      unknownLocations: Array.from(unknownLocations).sort(),
    },
  }
}
