import { describe, expect, it } from 'vitest'

import { mergeShapes, schemaProblems, typeAccepts, unrecorded, type SchemaShape } from './schemaCompat'

const str = { type: 'string' }
const num = { type: 'number' }
const before: SchemaShape = {
  presses: { name: { fieldType: str, optional: false }, hall: { fieldType: str, optional: true } },
  plants: {
    costCenters: { fieldType: { type: 'array', value: { type: 'object', value: { code: { fieldType: str, optional: false } } } }, optional: true },
  },
}

describe('şema uyumluluğu', () => {
  it('genişletme serbest: isteğe bağlı yeni alan, yeni tablo, birlik, iç nesneye isteğe bağlı alan', () => {
    const after: SchemaShape = {
      ...before,
      presses: { ...before.presses, costCenter: { fieldType: str, optional: true }, name: { fieldType: { type: 'union', value: [str, num] }, optional: false } },
      plants: {
        costCenters: {
          fieldType: { type: 'array', value: { type: 'object', value: { code: { fieldType: str, optional: false }, department: { fieldType: str, optional: true } } } },
          optional: true,
        },
      },
      auditLog: { at: { fieldType: num, optional: false } },
    }
    expect(schemaProblems(before, after)).toEqual([])
    expect(unrecorded(before, after).sort()).toEqual(['auditLog (new table)', 'presses.costCenter'])
  })

  it('kaldırma, zorunlu yapma, daraltma ve yeni zorunlu alan yakalanır', () => {
    const after: SchemaShape = {
      presses: { name: { fieldType: num, optional: false }, hall: { fieldType: str, optional: false }, code: { fieldType: str, optional: false } },
    }
    expect(schemaProblems(before, after)).toEqual([
      'presses.name: type narrowed or changed',
      'presses.hall: became required',
      'presses.code: new field must be optional',
      'plants: table removed',
    ])
  })

  it('iç nesnede zorunlu yeni alan da yakalanır; any her şeyi kabul eder', () => {
    const inner = (extra: object) => ({ type: 'array', value: { type: 'object', value: { code: { fieldType: str, optional: false }, ...extra } } })
    expect(typeAccepts(inner({}), inner({ dept: { fieldType: str, optional: false } }))).toBe(false)
    expect(typeAccepts(inner({}), { type: 'any' })).toBe(true)
  })

  it('kaydı güncellemek eski alanları silmez', () => {
    const merged = mergeShapes(before, { presses: { name: { fieldType: str, optional: false } } })
    expect(Object.keys(merged.presses)).toEqual(['hall', 'name'])
    expect(merged.plants).toBeDefined()
  })
})
