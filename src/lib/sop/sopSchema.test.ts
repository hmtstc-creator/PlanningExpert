import { describe, expect, it } from 'vitest'

import { aiToDraft, boxToMark, draftSchema, parseAiResult } from './sopSchema'

const answer = {
  adimlar: [
    {
      temel_adim: 'Şablonu arabanın merkezine göre ayarla',
      puf_noktasi: 'Araba üzerine çıkarken etrafın temiz olduğundan emin ol',
      nedeni: 'Kayma veya takılma nedeniyle iş kazası yaşanabilir',
      baslangic_sn: 3,
      bitis_sn: 11,
      kareler: [{ saniye: 7, isaret: [100, 200, 500, 600] }, { saniye: 95 }],
    },
  ],
  kkd: { is_ayakkabisi: true, eldiven: true, tisort_pantolon: false },
}

describe('Gemini cevabı', () => {
  it('geçerli cevap taslağa döner: saniye videoya kırpılır, kutu kesre çevrilir', () => {
    const r = parseAiResult(JSON.stringify(answer))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = aiToDraft(r.value, 80, { operation: 'Sac yükleme' })
    expect(d.header.operation).toBe('Sac yükleme')
    expect(d.header.tut).toBe('TÜT')
    expect(d.steps[0].photos).toEqual([
      { second: 7, mark: { x: 0.2, y: 0.1, w: 0.4, h: 0.4 } },
      { second: 80, mark: undefined },
    ])
    expect(d.ppe).toEqual({ shoes: true, gloves: true, clothes: false })
  })

  it('bozuk cevap: hata yolu ile birlikte döner (tekrar denemede modele gider)', () => {
    const r = parseAiResult({ ...answer, adimlar: [{ ...answer.adimlar[0], kareler: [] }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('adimlar.0.kareler')
    expect(parseAiResult('{nope').ok).toBe(false)
  })

  it('adım başına en çok 2 fotoğraf', () => {
    const three = { ...answer, adimlar: [{ ...answer.adimlar[0], kareler: [{ saniye: 1 }, { saniye: 2 }, { saniye: 3 }] }] }
    expect(parseAiResult(three).ok).toBe(false)
  })

  it('ters kutu işaretsiz sayılır', () => {
    expect(boxToMark([500, 0, 100, 10])).toBeUndefined()
  })

  it('taslak şeması ekrandaki hâli kabul eder', () => {
    const r = parseAiResult(answer)
    if (!r.ok) throw new Error(r.error)
    const d = aiToDraft(r.value, 80, {})
    expect(draftSchema.safeParse(d).success).toBe(true)
  })
})
