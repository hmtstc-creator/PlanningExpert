import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import schema from './schema'
import { mergeShapes, schemaProblems, shapeOf, unrecorded, type SchemaShape } from '../src/lib/schemaCompat'

/**
 * Canlı veriyi koruyan şema kapısı: scripts/schema.snapshot.json canlıdaki
 * şemanın kaydıdır. Yeni şema ondan yalnızca genişleyebilir. Yeni alan /
 * tablo eklenince kayıt `npm run schema:snapshot` ile güncellenir (commit'e
 * girer, incelemede görünür). Kaldırma: docs/deployment.md → Veri güvenliği.
 */
const FILE = 'scripts/schema.snapshot.json'
const current = shapeOf(schema as never)

describe('şema kapısı (veri kaybını önler)', () => {
  it('kayıtlı şemaya göre hiçbir şey kaldırılmamış, daraltılmamış, zorunlu yapılmamış', () => {
    if (process.env.UPDATE_SCHEMA_SNAPSHOT) {
      const before: SchemaShape = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf-8')) : {}
      expect(schemaProblems(before, current), 'Kayıt güncellenmeden önce uyumsuzluk giderilmeli').toEqual([])
      writeFileSync(FILE, `${JSON.stringify(mergeShapes(before, current), null, 2)}\n`)
      return
    }
    const before: SchemaShape = JSON.parse(readFileSync(FILE, 'utf-8'))
    expect(schemaProblems(before, current)).toEqual([])
  })

  it('yeni alan ve tablolar kayda işlenmiş (npm run schema:snapshot)', () => {
    if (process.env.UPDATE_SCHEMA_SNAPSHOT) return
    const before: SchemaShape = JSON.parse(readFileSync(FILE, 'utf-8'))
    expect(unrecorded(before, current)).toEqual([])
  })
})
