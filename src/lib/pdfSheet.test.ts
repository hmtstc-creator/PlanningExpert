import { describe, expect, it } from 'vitest'

import { pdfFileName } from './pdfFile'
import { pageMm, pageSlices } from './pdfSheet'

describe('PDF dosya adı', () => {
  it('GGAAYY SAYFA ADI, büyük harf, dosya adında olamayan işaretler yok', () => {
    expect(pdfFileName('2026-10-16', 'OEE loss bridge')).toBe('161026 OEE LOSS BRIDGE')
    expect(pdfFileName('2026-10-16', 'KPI weekly 2026/W42: PRS')).toBe('161026 KPI WEEKLY 2026 W42 PRS')
  })
})

describe('PDF sayfaları', () => {
  it('kâğıt ölçüsü', () => {
    expect(pageMm('A4', 'portrait')).toEqual({ w: 210, h: 297 })
    expect(pageMm('A3', 'landscape')).toEqual({ w: 420, h: 297 })
  })

  it('kısa parça tek sayfa', () => {
    expect(pageSlices(500, 1000, [])).toEqual([{ from: 0, to: 500 }])
  })

  it('sınıra denk gelen bölüm bir sonraki sayfaya geçer', () => {
    const s = pageSlices(2500, 1000, [
      { top: 0, bottom: 600 },
      { top: 620, bottom: 1300 },
      { top: 1320, bottom: 2500 },
    ])
    expect(s[0]).toEqual({ from: 0, to: 620 })
    expect(s[1]).toEqual({ from: 620, to: 1320 })
    // Sayfadan uzun bölüm bölünür.
    expect(s[2]).toEqual({ from: 1320, to: 2320 })
    expect(s.at(-1)!.to).toBe(2500)
  })

  it('sayfaların toplamı parçanın tamamı, boşluk ve örtüşme yok', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({ top: i * 230 + 10, bottom: i * 230 + 220 }))
    const s = pageSlices(2770, 700, blocks)
    expect(s[0].from).toBe(0)
    expect(s.at(-1)!.to).toBe(2770)
    for (let i = 1; i < s.length; i++) expect(s[i].from).toBe(s[i - 1].to)
    for (const p of s) expect(p.to - p.from).toBeLessThanOrEqual(700)
  })
})
