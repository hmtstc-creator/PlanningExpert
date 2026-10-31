// SOP taslağının sürüm geçmişi ve otomatik kayıt (kullanıcı 2026-10-31).
// Yalnız tarayıcıda (localStorage) tutulur: Word / dosya çıktısı üretilmez.
// Saf fonksiyonlar; depo (Storage) dışarıdan verilir ki testte sahte depo kullanılsın.

import { draftSchema, type Draft } from './sopSchema'

export interface SopVersion {
  /** 1, 2, 3 … (kayıt sırası; en çok MAX_VERSIONS tutulur, numara sürer). */
  v: number
  at: number
  note: string
  draft: Draft
}

export const MAX_VERSIONS = 50

/** Yeni sürüm ekler; en eski fazlaysa atar. Girdi listesi değişmez. */
export function addVersion(list: readonly SopVersion[], draft: Draft, note: string, at: number): SopVersion[] {
  const v = (list.at(-1)?.v ?? 0) + 1
  return [...list, { v, at, note: note.trim(), draft }].slice(-MAX_VERSIONS)
}

export const sameDraft = (a: Draft, b: Draft): boolean => JSON.stringify(a) === JSON.stringify(b)

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const versionsKey = (id: string) => `sop-versions:${id}`
const autosaveKey = (id: string) => `sop-autosave:${id}`

/** Bozuk ya da eski kayıt sessizce yok sayılır. */
export function readVersions(store: Store, id: string): SopVersion[] {
  try {
    const raw = JSON.parse(store.getItem(versionsKey(id)) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x): x is SopVersion => typeof x?.v === 'number' && typeof x?.at === 'number' && typeof x?.draft === 'object' && x.draft !== null)
      .slice(-MAX_VERSIONS)
  } catch {
    return []
  }
}

export function writeVersions(store: Store, id: string, list: readonly SopVersion[]): void {
  store.setItem(versionsKey(id), JSON.stringify(list.slice(-MAX_VERSIONS)))
}

export interface Autosave {
  draft: Draft
  savedAt: number
}

export function readAutosave(store: Store, id: string): Autosave | null {
  try {
    const raw = JSON.parse(store.getItem(autosaveKey(id)) ?? 'null') as Autosave | null
    if (!raw || typeof raw.savedAt !== 'number') return null
    const ok = draftSchema.safeParse(raw.draft)
    return ok.success ? { draft: raw.draft, savedAt: raw.savedAt } : null
  } catch {
    return null
  }
}

export function writeAutosave(store: Store, id: string, draft: Draft, at: number): void {
  store.setItem(autosaveKey(id), JSON.stringify({ draft, savedAt: at }))
}

export function clearAutosave(store: Store, id: string): void {
  store.removeItem(autosaveKey(id))
}
