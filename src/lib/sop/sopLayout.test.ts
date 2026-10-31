import { readFileSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  COLS,
  REGIONS,
  ROWS,
  SHEET_H,
  SHEET_W,
  STEPS_PER_PAGE,
  colPx,
  pageLabel,
  paginate,
  PPE_ITEMS,
  ppeCellRects,
  parseRange,
  rect,
  rowPt,
  slotRefs,
  stepNumber,
} from './sopLayout'

// Şablonun kendisi: yerleşim buna %100 uymak zorunda (kullanıcı, 2026-10-29).
const wb = XLSX.read(readFileSync('docs/sop/sop-sablon.xlsx'), { cellStyles: true })
const ws = wb.Sheets[wb.SheetNames[0]]
const key = (r: { c1: number; r1: number; c2: number; r2: number }) => `${r.c1},${r.r1},${r.c2},${r.r2}`
const merges = new Set(
  (ws['!merges'] ?? [])
    .filter((m) => m.e.c < COLS && m.e.r < ROWS)
    .map((m) => key({ c1: m.s.c + 1, r1: m.s.r + 1, c2: m.e.c + 1, r2: m.e.r + 1 })),
)
const slotRanges = Array.from({ length: STEPS_PER_PAGE }, (_, s) => slotRefs(s)).flatMap((s) => [s.photo, s.step, s.key, s.reason])
const ours = [...REGIONS.map((r) => r.ref), ...slotRanges]

describe('SOP yerleşimi = şablon', () => {
  it('B…BC sütunları şablonla aynı oranda büyür; A sütunu şablondaki gibi', () => {
    const tplA = (ws['!cols']?.[0]?.width ?? 0) * 7
    const tplB = (ws['!cols']?.[1]?.width ?? 0) * 7
    for (let c = 2; c <= COLS; c++) {
      expect(colPx(c), `sütun ${c}`).toBeCloseTo(colPx(2), 6)
      expect((ws['!cols']?.[c - 1]?.width ?? 0) * 7, `şablon sütun ${c}`).toBeCloseTo(tplB, 6)
    }
    expect(colPx(1)).toBeCloseTo(tplA, 6) // A sütunu şablonda kalır (etiket sütunu)
  })

  it('satır yükseklikleri şablonla aynı', () => {
    for (let r = 1; r <= ROWS; r++) expect(ws['!rows']?.[r - 1]?.hpt, `satır ${r}`).toBe(rowPt(r))
  })

  it('her kutu şablonda birleştirilmiş bir aralık', () => {
    for (const ref of ours) {
      const r = parseRange(ref)
      if (r.c1 === r.c2 && r.r1 === r.r2) continue
      expect(merges.has(key(r)), ref).toBe(true)
    }
  })

  it('şablonun bütün birleştirmeleri çiziliyor (eksik kutu yok)', () => {
    const drawn = new Set(ours.map((ref) => key(parseRange(ref))))
    expect([...merges].filter((m) => !drawn.has(m))).toEqual([])
  })

  it('sabit yazılar şablondakiyle harfi harfine aynı', () => {
    for (const r of REGIONS) {
      if (r.kind !== 'text') continue
      const cell = ws[r.ref.split(':')[0]]
      expect(String(cell?.v ?? ''), r.ref).toBe(r.text)
    }
  })

  it('sayfa oranı A3 yatay içeriği (her yanda 5 mm) tam doldurur', () => {
    expect(SHEET_W / SHEET_H).toBeCloseTo((410 / 287), 3)
    const r = rect('B12:S30')
    expect(r.left).toBeCloseTo(109, 6)
    expect(r.width).toBeCloseTo(18 * colPx(2), 6)
    expect(r.height).toBeCloseTo((19 * 15 * 4) / 3, 6)
  })
})

describe('sayfa çoğaltma', () => {
  it('8 adım → 2 sayfa; 2. sayfada 2 dolu, 4 boş kutu; numara devam eder', () => {
    const pages = paginate(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(pages).toHaveLength(2)
    expect(pages[1]).toEqual(['g', 'h', null, null, null, null])
    expect(stepNumber(1, 0)).toBe(7)
    expect(pageLabel(1, 2)).toBe('2/2')
  })

  it('adımsız form da bir sayfa', () => {
    expect(paginate([])).toEqual([[null, null, null, null, null, null]])
  })
})

describe('KKD satırı (seçime göre)', () => {
  it('seçili kalem yok → çizim yok; üç kalem → eşit genişlik, satır içinde', () => {
    expect(ppeCellRects(0)).toEqual([])
    const cells = ppeCellRects(3)
    expect(cells).toHaveLength(3)
    expect(cells[0].width).toBeCloseTo(cells[2].width, 6)
    const row = rect('H81:BC83')
    expect(cells[0].left).toBeCloseTo(row.left, 6)
    expect(cells[2].left + cells[2].width).toBeLessThanOrEqual(row.left + row.width + 0.001)
  })

  it('en çok 380 px; kalem sayısı artınca genişlik küçülür', () => {
    expect(ppeCellRects(1)[0].width).toBe(380)
    expect(ppeCellRects(13)[0].width).toBeLessThan(ppeCellRects(2)[0].width)
  })
})

describe('KKD kalemleri', () => {
  it('her kalemin Türkçe ve Rumence adı var; görsel dosyası mevcut', () => {
    for (const item of PPE_ITEMS) {
      expect(item.tr.trim(), item.key).not.toBe('')
      expect(item.ro.trim(), item.key).not.toBe('')
      expect(statSync(`public/sop/ppe/${item.icon}`).size, item.key).toBeGreaterThan(1000)
    }
  })

  it('anahtarlar benzersiz', () => {
    const keys = PPE_ITEMS.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
