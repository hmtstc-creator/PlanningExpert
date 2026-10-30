import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  COLS,
  REGIONS,
  ROWS,
  SHEET_W,
  STEPS_PER_PAGE,
  colPx,
  pageLabel,
  paginate,
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
  it('sütun genişlikleri şablonla aynı', () => {
    for (let c = 1; c <= COLS; c++) expect(Math.round((ws['!cols']?.[c - 1]?.width ?? 0) * 7), `sütun ${c}`).toBe(colPx(c))
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

  it('sayfa genişliği: A 109 px + 54 × 33 px', () => {
    expect(SHEET_W).toBe(1891)
    expect(rect('B12:S30')).toEqual({ left: 109, top: rect('A12').top, width: 18 * 33, height: (19 * 15 * 4) / 3 })
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
