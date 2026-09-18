import { describe, expect, it } from 'vitest'

import { uploadMessage } from './uploadMessage'

const clean = {
  count: 120,
  skippedUnknownMaterial: 0,
  skippedUnknownLocation: 0,
  unknownMaterials: [],
  unknownLocations: [],
}

describe('uploadMessage', () => {
  it('reports a clean import in one sentence', () => {
    expect(uploadMessage('stock rows', clean)).toBe('120 stock rows imported.')
  })

  it('names the materials that were skipped', () => {
    const msg = uploadMessage('stock rows', {
      ...clean,
      skippedUnknownMaterial: 3,
      unknownMaterials: ['X1', 'X2'],
    })
    expect(msg).toContain('3 rows skipped')
    expect(msg).toContain('X1, X2')
  })

  it('names skipped storage locations and says how to include them', () => {
    const msg = uploadMessage('stock rows', {
      ...clean,
      skippedUnknownLocation: 5,
      unknownLocations: ['1009', '2009'],
    })
    expect(msg).toContain('storage location not defined')
    expect(msg).toContain('1009, 2009')
    expect(msg).toContain('Storage Locations page')
  })

  it('truncates a long list rather than dumping it', () => {
    const many = Array.from({ length: 12 }, (_, i) => `M${i}`)
    const msg = uploadMessage('rows', {
      ...clean,
      skippedUnknownMaterial: 12,
      unknownMaterials: many,
    })
    expect(msg).toContain('…')
    expect(msg).not.toContain('M9')
  })

  it('warns explicitly when everything was filtered out', () => {
    const msg = uploadMessage('stock rows', {
      ...clean,
      count: 0,
      skippedUnknownMaterial: 40,
      unknownMaterials: ['A'],
    })
    expect(msg).toContain('Nothing was imported')
  })

  it('stays quiet about the check when nothing was skipped', () => {
    expect(uploadMessage('rows', clean)).not.toContain('skipped')
  })
})
