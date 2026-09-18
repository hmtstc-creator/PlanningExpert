// Turns an upload's filter report into a sentence the planner can act on.
//
// Filtering is silent data loss unless the user is told what was dropped and
// why. Storage location codes in particular used to be discovered from MB52;
// now that unknown ones are rejected, the upload message is the only place
// they surface, so it has to name them.

export interface UploadReport {
  count: number
  skippedUnknownMaterial: number
  skippedUnknownLocation: number
  unknownMaterials: string[]
  unknownLocations: string[]
}

export function uploadMessage(what: string, report: UploadReport): string {
  const parts = [`${report.count.toLocaleString('en-GB')} ${what} imported.`]

  if (report.skippedUnknownMaterial > 0) {
    parts.push(
      `${report.skippedUnknownMaterial.toLocaleString('en-GB')} rows skipped — ` +
        `material not in master data` +
        (report.unknownMaterials.length > 0
          ? ` (${report.unknownMaterials.slice(0, 8).join(', ')}` +
            `${report.unknownMaterials.length > 8 ? ', …' : ''}).`
          : '.'),
    )
  }

  if (report.skippedUnknownLocation > 0) {
    parts.push(
      `${report.skippedUnknownLocation.toLocaleString('en-GB')} rows skipped — ` +
        `storage location not defined` +
        (report.unknownLocations.length > 0
          ? ` (${report.unknownLocations.slice(0, 8).join(', ')}` +
            `${report.unknownLocations.length > 8 ? ', …' : ''}).` +
            ' Define them on the Storage Locations page to include them.'
          : '.'),
    )
  }

  if (report.count === 0 && parts.length > 1) {
    parts.push('Nothing was imported — check master data and storage locations first.')
  }

  return parts.join(' ')
}
