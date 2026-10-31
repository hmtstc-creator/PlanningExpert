import { describe, expect, it } from 'vitest'

import { filterSops, matchesSop } from './sopSearch'

const rows = [
  { operation: 'Sac yükleme', reference: 'V769', sopNo: 'SOP-001' },
  { operation: 'Balyalama', reference: 'K-20', sopNo: '' },
  { operation: 'Lazer markalama', reference: 'LM-7', sopNo: 'SOP-002' },
]

describe('SOP arama', () => {
  it('boş arama her satırı getirir', () => {
    expect(filterSops(rows, '   ')).toHaveLength(3)
  })

  it('başlıkta ve kodda arar; büyük-küçük harf farkı yok', () => {
    expect(filterSops(rows, 'SAC').map((r) => r.reference)).toEqual(['V769'])
    expect(filterSops(rows, 'k-20').map((r) => r.operation)).toEqual(['Balyalama'])
    expect(filterSops(rows, 'sop-00').map((r) => r.reference)).toEqual(['V769', 'LM-7'])
  })

  it('Türkçe I/İ: "ı" ile "I" aynı kabul edilmez, "İ" → "i" küçülür', () => {
    expect(matchesSop({ operation: 'İşlem', reference: '', sopNo: '' }, 'i')).toBe(true)
  })

  it('eşleşme yoksa boş liste', () => {
    expect(filterSops(rows, 'yok')).toEqual([])
  })
})
