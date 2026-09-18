import { describe, expect, it } from 'vitest'

import {
  changedProductFields,
  PRODUCT_FIELDS,
  productDraftOf,
  sameProductDraft,
} from './productDraft'

const product = {
  code: 'M250SP001RO',
  coProduct: 'M250SP002RO',
  moldCavities: 2,
  spm: 16,
  rawMaterialCode: 'SD51-100-0976',
  coilWeight: 8000,
  grossWeight: 1.465,
  setupMinutes: 30,
  coilSetupMinutes: 15,
  mainMachine: 'PRS-107',
  altMachine1: 'PRS-108',
  maxShots: 500_000,
  qualityApprovalMinutes: 10,
  performanceFactor: 0.8,
}

describe('master data taslağı', () => {
  it('her alanı metne çevirir, tanımsızı boş kutu yapar', () => {
    const draft = productDraftOf(product)
    expect(draft.moldCavities).toBe('2')
    expect(draft.grossWeight).toBe('1.465')
    // Tanımlanmamış alternatif makineler boş kutu olur, "undefined" değil.
    expect(draft.altMachine2).toBe('')
    expect(draft.altMachine4).toBe('')
  })

  it('sıfır boş kutuyla karıştırılmaz', () => {
    const draft = productDraftOf({ ...product, qualityApprovalMinutes: 0 })
    expect(draft.qualityApprovalMinutes).toBe('0')
    expect(draft.qualityApprovalMinutes).not.toBe('')
  })

  it('bütün düzenlenebilir alanları kapsar', () => {
    const draft = productDraftOf(product)
    expect(Object.keys(draft).sort()).toEqual(PRODUCT_FIELDS.map((f) => f.name).sort())
  })

  it('yalnızca gerçekten değişen alanları yazar', () => {
    const server = productDraftOf(product)
    const edited = { ...server, spm: '20', mainMachine: 'PRS-109' }
    expect(changedProductFields(edited, server).map((f) => f.name)).toEqual([
      'spm',
      'mainMachine',
    ])
    expect(changedProductFields(server, server)).toEqual([])
  })

  it('sayısal alanları işaretler', () => {
    const numeric = PRODUCT_FIELDS.filter((f) => f.numeric).map((f) => f.name)
    expect(numeric).toContain('spm')
    expect(numeric).toContain('grossWeight')
    expect(numeric).not.toContain('mainMachine')
    expect(numeric).not.toContain('code')
  })

  it('değişiklik tespiti tek alanda bile çalışır', () => {
    const a = productDraftOf(product)
    expect(sameProductDraft(a, productDraftOf(product))).toBe(true)
    expect(sameProductDraft(a, { ...a, altMachine3: 'PRS-110' })).toBe(false)
  })
})
