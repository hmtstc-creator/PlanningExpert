import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Planning Logic üç dilde: İngilizce kaynak, Türkçe ve Romence çeviri. Çeviri
// eksik kalmasın diye bölüm kimlikleri ve koddan okunan değerler aynı olmalı.
const read = (p: string) => readFileSync(p, 'utf8')
const en = read('src/routes/planlogic.tsx')
const pages = {
  tr: read('src/components/planlogic/PlanLogicTr.tsx'),
  ro: read('src/components/planlogic/PlanLogicRo.tsx'),
}
const ids = (s: string) => [...s.matchAll(/\bid="([^"]+)"|<Step\s[^>]*?id="([^"]+)"/g)].map((m) => m[1] ?? m[2])
const exprs = (s: string) => [...s.matchAll(/\{(current\.\w+|SETTINGS_DEFAULTS\.\w+)\}/g)].map((m) => m[1]).sort()
// Kaynağın yalnız sayfa gövdesi (dil seçici sarmalayıcı hariç).
const enBody = en.slice(en.indexOf('function PlanLogicEn() {'))

describe.each(Object.entries(pages))('Planning Logic %s translation', (_lang, page) => {
  it('has the same section ids as the English page', () => {
    expect(ids(page)).toEqual(ids(enBody))
  })
  it('shows the same values read from code', () => {
    expect(exprs(page)).toEqual(exprs(enBody))
  })
})
