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

export interface FilterOptions<Row> {
  rows: Row[]
  materialOf: (row: Row) => string
  /** Omit when the upload has no storage location dimension. */
  locationOf?: (row: Row) => string | undefined
  knownMaterials: Set<string>
  knownLocations?: Set<string>
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
  const { rows, materialOf, locationOf, knownMaterials, knownLocations } = options
  const checkMaterial = knownMaterials.size > 0
  const checkLocation = !!locationOf && !!knownLocations && knownLocations.size > 0

  const kept: Row[] = []
  const unknownMaterials = new Set<string>()
  const unknownLocations = new Set<string>()
  let skippedUnknownMaterial = 0
  let skippedUnknownLocation = 0

  for (const row of rows) {
    const material = materialOf(row).trim()
    if (!material) continue

    if (checkMaterial && !knownMaterials.has(material)) {
      skippedUnknownMaterial++
      if (unknownMaterials.size < MAX_REPORTED) unknownMaterials.add(material)
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
