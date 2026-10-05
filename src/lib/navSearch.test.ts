import { describe, expect, it } from 'vitest'

import { PAGE_KEYWORDS, fold, pageIndex, searchPages } from './navSearch'

const top = (q: string) => searchPages(pageIndex(), q)[0]?.to

describe('sayfa araması (Ctrl+K)', () => {
  const index = pageIndex()

  it('her sayfa bir kez; her birinin Türkçe anahtar kelimesi var', () => {
    const tos = index.map((p) => p.to)
    expect(new Set(tos).size).toBe(tos.length)
    for (const to of tos) expect(PAGE_KEYWORDS[to], to).toBeTruthy()
  })

  it('Türkçe harflerden bağımsız', () => {
    expect(fold('ARIZA Şişe İğne çöp')).toBe('ariza sise igne cop')
  })

  it('ad başı önce gelir', () => {
    expect(top('cap')).toBe('/capacity')
    expect(top('work cal')).toBe('/takvim')
  })

  it('Türkçe ve SAP kelimeleriyle bulur', () => {
    expect(top('arıza')).toBe('/machine-followup/breakdowns')
    expect(top('ariza')).toBe('/machine-followup/breakdowns')
    expect(top('mb52')).toBe('/stoklar')
    expect(top('kalıp bakım')).toBe('/die-followup/maintenance')
    expect(top('şifre')).toBe('/account')
  })

  it('her kelime geçmeli; boş arama boş', () => {
    expect(searchPages(index, 'stock zzzz')).toEqual([])
    expect(searchPages(index, '   ')).toEqual([])
  })

  it('grup ve modül adı taşınır', () => {
    const wc = index.find((p) => p.to === '/makineler')!
    expect(wc).toMatchObject({ section: 'PlanningExpert', group: 'Master data', icon: 'factory', accent: 'indigo' })
    expect(index.find((p) => p.to === '/kpi/weekly/entry')!.group).toBe('Weekly')
  })
})
