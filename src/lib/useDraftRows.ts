import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { dirtyKeys, mergeDrafts } from './draftMerge'

/**
 * Bir tablodaki satırların düzenlenebilir hâlini yönetir.
 *
 * Neden: alanlar eskiden `onBlur`'da sessizce kaydediliyordu. Kullanıcı
 * kaydedip kaydetmediğini göremiyordu, hata olursa hiç öğrenemiyordu ve
 * kayıt kısmi gittiği için bir alanı düzenlemek diğerlerini uçurabiliyordu.
 * Artık her satırın tek bir taslağı var; kaydetmek açık bir eylem.
 */
export function useDraftRows<Row, Draft>(
  rows: Row[],
  keyOf: (row: Row) => string,
  draftOf: (row: Row) => Draft,
  same: (a: Draft, b: Draft) => boolean,
) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({})
  const baseline = useRef<Record<string, Draft>>({})

  const server = useMemo(() => {
    const map: Record<string, Draft> = {}
    for (const row of rows) map[keyOf(row)] = draftOf(row)
    return map
    // rows her render'da yeni dizi olabilir; içerik imzasına bağlanıyor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rows.map((r) => [keyOf(r), draftOf(r)]))])

  useEffect(() => {
    setDrafts((current) => {
      const merged = mergeDrafts(server, current, baseline.current, same)
      baseline.current = merged.baseline
      return merged.drafts
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server])

  const dirty = useMemo(() => dirtyKeys(server, drafts, same), [server, drafts, same])

  const edit = useCallback((key: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
    setJustSaved((s) => (s[key] ? { ...s, [key]: false } : s))
  }, [])

  const draftFor = useCallback(
    (row: Row) => drafts[keyOf(row)] ?? draftOf(row),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts],
  )

  const isDirty = useCallback(
    (row: Row) => {
      const key = keyOf(row)
      const draft = drafts[key]
      return draft !== undefined && !same(draft, draftOf(row))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts],
  )

  /** `save` false dönerse kayıt başarısızdır; taslak ekranda kalır. */
  const commit = useCallback(
    async (key: string, save: (draft: Draft) => Promise<boolean>): Promise<boolean> => {
      const draft = drafts[key]
      if (draft === undefined) return false
      setSavingKey(key)
      let ok = false
      try {
        ok = await save(draft)
      } finally {
        setSavingKey(null)
      }
      if (ok) {
        setJustSaved((s) => ({ ...s, [key]: true }))
        setTimeout(() => setJustSaved((s) => ({ ...s, [key]: false })), 3000)
      }
      return ok
    },
    [drafts],
  )

  /** Sırayla kaydeder; ilk hatada durur, kalanlar ekranda kalır. */
  const commitAll = useCallback(
    async (save: (key: string, draft: Draft) => Promise<boolean>) => {
      for (const key of dirty) {
        const ok = await commit(key, (draft) => save(key, draft))
        if (!ok) return false
      }
      return true
    },
    [dirty, commit],
  )

  const discardAll = useCallback(() => setDrafts(server), [server])

  return {
    draftFor,
    isDirty,
    edit,
    commit,
    commitAll,
    discardAll,
    dirtyKeys: dirty,
    savingKey,
    justSaved,
  }
}
