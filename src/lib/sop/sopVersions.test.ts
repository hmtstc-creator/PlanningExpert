import { describe, expect, it } from 'vitest'

import { addVersion, clearAutosave, MAX_VERSIONS, readAutosave, readVersions, sameDraft, writeAutosave, writeVersions } from './sopVersions'
import { emptyDraft, type Draft } from './sopSchema'

/** Sahte depo: localStorage'ın üç işlevi. */
function memoryStore() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

const draft = (text: string): Draft => ({ ...emptyDraft(), steps: [{ text, key: '', reason: '', photos: [] }] })

describe('sürüm geçmişi', () => {
  it('v1, v2, v3 sırayla numaralanır; not kırpılır', () => {
    let list = addVersion([], draft('a'), '  ilk  ', 1)
    list = addVersion(list, draft('b'), '', 2)
    list = addVersion(list, draft('c'), 'üçüncü', 3)
    expect(list.map((x) => x.v)).toEqual([1, 2, 3])
    expect(list[0].note).toBe('ilk')
  })

  it('en çok MAX_VERSIONS tutar, numara sürer', () => {
    let list: ReturnType<typeof addVersion> = []
    for (let i = 0; i < MAX_VERSIONS + 5; i++) list = addVersion(list, draft(String(i)), '', i)
    expect(list).toHaveLength(MAX_VERSIONS)
    expect(list[0].v).toBe(6)
    expect(list.at(-1)?.v).toBe(MAX_VERSIONS + 5)
  })

  it('depoya yazılıp okunur; bozuk kayıt boş liste döner', () => {
    const store = memoryStore()
    writeVersions(store, 'x', addVersion([], draft('a'), 'n', 1))
    expect(readVersions(store, 'x')).toHaveLength(1)
    store.setItem('sop-versions:y', '{bozuk')
    expect(readVersions(store, 'y')).toEqual([])
  })
})

describe('otomatik kayıt', () => {
  it('yazılan taslak geri okunur; geçersiz taslak reddedilir', () => {
    const store = memoryStore()
    writeAutosave(store, 'x', draft('yarım'), 42)
    expect(readAutosave(store, 'x')).toEqual({ draft: draft('yarım'), savedAt: 42 })
    store.setItem('sop-autosave:z', JSON.stringify({ savedAt: 1, draft: { header: 'yanlış' } }))
    expect(readAutosave(store, 'z')).toBeNull()
  })

  it('temizlenince kayıt kalmaz', () => {
    const store = memoryStore()
    writeAutosave(store, 'x', draft('a'), 1)
    clearAutosave(store, 'x')
    expect(readAutosave(store, 'x')).toBeNull()
  })

  it('sameDraft: aynı içerik eşit, farklı metin değil', () => {
    expect(sameDraft(draft('a'), draft('a'))).toBe(true)
    expect(sameDraft(draft('a'), draft('b'))).toBe(false)
  })
})
