import { describe, expect, it } from 'vitest'

import guides from './sopGuide.i18n.json'

describe('SOP kılavuzu (tr / en / ro)', () => {
  const langs = Object.keys(guides) as (keyof typeof guides)[]

  it('üç dil de var', () => {
    expect(langs.sort()).toEqual(['en', 'ro', 'tr'])
  })

  it('her dilde aynı sayıda bölüm; başlık ve her bölümde en az bir adım dolu', () => {
    const counts = langs.map((l) => guides[l].sections.length)
    expect(new Set(counts).size).toBe(1)
    for (const l of langs) {
      expect(guides[l].title.trim()).not.toBe('')
      for (const s of guides[l].sections) {
        expect(s.title.trim(), `${l}: başlık`).not.toBe('')
        expect(s.steps.length, `${l}: ${s.title}`).toBeGreaterThan(0)
        for (const t of s.steps) expect(t.trim(), `${l}: boş adım`).not.toBe('')
      }
    }
  })
})
