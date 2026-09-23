import { describe, expect, it } from 'vitest'

import { filterMaterials, isKnownMaterial, type MaterialOption } from './materialFilter'

const options: MaterialOption[] = [
  { code: 'M250SP002RO' },
  { code: 'M250SP001RO', coProduct: 'M250SP002RO' },
  { code: 'M315AB010RO' },
  { code: 'B999' },
]

describe('malzeme süzme', () => {
  it('sorgu boşken hepsini alfabetik verir', () => {
    expect(filterMaterials(options, '').map((o) => o.code)).toEqual([
      'B999',
      'M250SP001RO',
      'M250SP002RO',
      'M315AB010RO',
    ])
  })

  it('tam eşleşme en başta', () => {
    const result = filterMaterials(options, 'M250SP002RO')
    expect(result[0].code).toBe('M250SP002RO')
  })

  it('baştan eşleşme, içeride geçenden önce gelir', () => {
    const result = filterMaterials(options, 'M250').map((o) => o.code)
    expect(result).toEqual(['M250SP001RO', 'M250SP002RO'])
  })

  it('içeride geçeni de bulur', () => {
    expect(filterMaterials(options, 'AB010').map((o) => o.code)).toEqual(['M315AB010RO'])
  })

  it('büyük küçük harf ayırmaz', () => {
    expect(filterMaterials(options, 'm315').map((o) => o.code)).toEqual(['M315AB010RO'])
  })

  it('eş üründen de bulur ama en sona koyar', () => {
    // 'M250SP002RO' hem kendi kodu hem M250SP001RO'nun eş ürünü.
    const result = filterMaterials(options, 'M250SP002RO').map((o) => o.code)
    expect(result[0]).toBe('M250SP002RO')
    expect(result).toContain('M250SP001RO')
  })

  it('eşleşme yoksa boş döner', () => {
    expect(filterMaterials(options, 'ZZZ')).toEqual([])
  })

  it('baştaki ve sondaki boşluğu yok sayar', () => {
    expect(filterMaterials(options, '  B999  ').map((o) => o.code)).toEqual(['B999'])
  })

  it('listeyi sınırlar', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ code: `M${String(i).padStart(3, '0')}` }))
    expect(filterMaterials(many, '', 10)).toHaveLength(10)
    expect(filterMaterials(many, 'M', 5)).toHaveLength(5)
  })

  it('aynı sıradakiler alfabetik kalır — liste yazarken zıplamasın', () => {
    const result = filterMaterials(options, 'RO').map((o) => o.code)
    expect(result).toEqual([...result].sort())
  })
})

describe('tanınan malzeme', () => {
  it('master data\'daki kodu tanır', () => {
    expect(isKnownMaterial(options, 'M250SP001RO')).toBe(true)
    expect(isKnownMaterial(options, '  m250sp001ro ')).toBe(true)
  })

  it('olmayan kodu tanımaz', () => {
    expect(isKnownMaterial(options, 'YOK123')).toBe(false)
  })

  it('boş değer tanınmaz', () => {
    // Boşu "geçerli" saymak, uyarıyı hiç göstermemek olurdu.
    expect(isKnownMaterial(options, '')).toBe(false)
    expect(isKnownMaterial(options, '   ')).toBe(false)
  })
})
