import { createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ErrorBanner } from '../components/ErrorBanner'
import {
  draftOf,
  pressPayload,
  sameDraft,
  type PressDraft as Draft,
} from '../lib/pressDraft'
import { useSafeMutation } from '../lib/useSafeMutation'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/makineler')({
  component: MakinelerPage,
})

type Press = {
  _id: string
  name: string
  hall: string
  category?: string
  feedsCoil?: boolean
  tonnage?: number
  frozenDays?: number
}

// Suggestions only — any text is accepted, since every shop names its press
// types differently.
const CATEGORY_SUGGESTIONS = [
  'Transfer press',
  'Progressive 800 t',
  'Progressive 500 t',
  'Progressive 400 t',
  'Single stage',
]

function MakinelerPage() {
  const presses = (useQuery(api.presses.list) ?? []) as Press[]
  const {
    run: upsert,
    error: upsertError,
    clearError,
  } = useSafeMutation(api.presses.upsert)
  const { run: remove, error: removeError } = useSafeMutation(api.presses.remove)
  const { results: products } = usePaginatedQuery(
    api.products.list,
    {},
    { initialNumItems: 500 },
  )

  const [name, setName] = useState('')
  const [hall, setHall] = useState('')
  const [category, setCategory] = useState('')
  const [feedsCoil, setFeedsCoil] = useState(true)
  const [tonnage, setTonnage] = useState('')
  const [saving, setSaving] = useState(false)

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({})

  const byName = useMemo(() => new Map(presses.map((p) => [p.name, p])), [presses])

  const serverDrafts = useMemo(() => {
    const map: Record<string, Draft> = {}
    for (const p of presses) map[p._id] = draftOf(p)
    return map
  }, [presses])
  const signature = JSON.stringify(serverDrafts)

  // Son görülen sunucu hâli. Kullanıcının yazdığını silmemek için: yerel
  // değer sunucudan farklıysa ve sunucu tarafı bu arada değişmediyse yerel
  // düzenleme korunur; başka bir cihaz kaydı değiştirdiyse o kazanır.
  const baseline = useRef<Record<string, Draft>>({})
  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, Draft> = {}
      for (const [id, server] of Object.entries(serverDrafts)) {
        const local = current[id]
        const base = baseline.current[id]
        const locallyEdited = local && base && !sameDraft(local, base)
        const serverChanged = !base || !sameDraft(base, server)
        next[id] = locallyEdited && !serverChanged ? local : server
      }
      baseline.current = serverDrafts
      return next
    })
    // serverDrafts her render'da yeni nesne olur; içerik imzasına bağlanıyor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const dirtyIds = useMemo(
    () =>
      Object.keys(serverDrafts).filter(
        (id) => drafts[id] && !sameDraft(drafts[id], serverDrafts[id]),
      ),
    [drafts, serverDrafts],
  )

  // Kaydedilmemiş değişiklikle sayfadan çıkılırsa tarayıcı uyarsın.
  useEffect(() => {
    if (dirtyIds.length === 0) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtyIds.length])

  function editDraft(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
    setJustSaved((s) => (s[id] ? { ...s, [id]: false } : s))
  }

  const saveRow = useCallback(
    async (press: Press, draft: Draft): Promise<boolean> => {
      setSavingId(press._id)
      let ok = false
      try {
        // Kayıt her zaman eksiksiz gönderilir: sunucu tarafı gelmeyen alanı
        // silinmiş sayar, bu yüzden kısmi gönderim diğer alanları uçurur.
        ok = await upsert(pressPayload(press.name, draft))
      } finally {
        setSavingId(null)
      }
      if (ok) {
        setJustSaved((s) => ({ ...s, [press._id]: true }))
        setTimeout(
          () => setJustSaved((s) => ({ ...s, [press._id]: false })),
          3000,
        )
      }
      return ok
    },
    [upsert],
  )

  async function saveAll() {
    for (const id of dirtyIds) {
      const press = presses.find((p) => p._id === id)
      const draft = drafts[id]
      if (!press || !draft) continue
      const ok = await saveRow(press, draft)
      if (!ok) return
    }
  }

  function discardAll() {
    setDrafts(serverDrafts)
  }

  // Referanslardaki ana/alternatif makine alanlarında geçen ama henüz
  // tanımlanmamış presler — tek tıkla eklenebilsin.
  const undefinedPresses = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) {
      for (const m of [p.mainMachine, p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4]) {
        if (m && m.trim() && !byName.has(m.trim())) set.add(m.trim())
      }
    }
    return Array.from(set).sort()
  }, [products, byName])

  const halls = useMemo(() => {
    const map = new Map<string, Press[]>()
    for (const p of presses) {
      const key = p.hall || '(no hall assigned)'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [presses])

  async function addPress() {
    const n = name.trim()
    if (!n) return
    setSaving(true)
    let ok = false
    try {
      ok = await upsert({
        name: n,
        hall: hall.trim() || 'Hall 1',
        category: category.trim() || undefined,
        feedsCoil,
        tonnage: tonnage.trim() === '' ? undefined : Number(tonnage),
      })
    } finally {
      setSaving(false)
    }
    // Girdileri yalnızca kayıt gerçekten başarılıysa temizle.
    if (ok) {
      setName('')
      setTonnage('')
    }
  }

  const inputClass =
    'rounded-md border border-input bg-background px-2 py-1 text-sm'

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Press Definitions</h1>
      <p className="mt-2 text-muted-foreground">
        Define which hall each press sits in — presses in the same hall cannot
        set up at the same time, which is the crane constraint the planner
        relies on. The category is for grouping the plan on screen only;
        which press can run a material still comes from the main and
        alternative machines in master data. Coil fed marks a progressive line:
        the first coil goes on during setup and every coil after it costs a coil
        change. A transfer press runs blanks, so it has a single setup and no
        coil changes — untick it there. Frozen days locks that press's plan for
        the given number of days; leave it empty to use the global setting.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Edits in the table below are <strong className="text-foreground">not</strong>{' '}
        saved until you press Save on that row, or Save all at the bottom of the
        page. An edited row is marked until it is saved.
      </p>

      <ErrorBanner message={upsertError ?? removeError} onDismiss={clearError} />

      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Press name</span>
          <input
            className="mt-1 w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="PRS-107"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addPress()
            }}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Hall</span>
          <input
            className="mt-1 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Hol 1"
            value={hall}
            onChange={(e) => setHall(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Category</span>
          <input
            className="mt-1 w-44 rounded-md border border-input bg-background px-3 py-2 text-sm"
            list="press-categories"
            placeholder="Progressive 800 t"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="press-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={feedsCoil}
            onChange={(e) => setFeedsCoil(e.target.checked)}
          />
          <span className="text-xs text-muted-foreground">
            Coil fed
            <span className="block text-[10px]">uncheck for transfer presses</span>
          </span>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Tonnage (opt.)</span>
          <input
            type="number"
            className="mt-1 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="250"
            value={tonnage}
            onChange={(e) => setTonnage(e.target.value)}
          />
        </label>
        <button
          onClick={() => void addPress()}
          disabled={!name.trim() || saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add press'}
        </button>
      </div>

      {undefinedPresses.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Presses referenced in master data but not yet defined
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {undefinedPresses.map((p) => (
              <button
                key={p}
                onClick={() =>
                  void upsert({
                    name: p,
                    hall: hall.trim() || 'Hall 1',
                    category: category.trim() || undefined,
                    feedsCoil,
                  })
                }
                className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200"
              >
                + {p}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Clicking adds the press with the hall, category and coil setting
            entered in the boxes above.
          </p>
        </div>
      )}

      {presses.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No presses defined yet.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {halls.map(([hallName, list]) => (
            <div key={hallName}>
              <h2 className="text-sm font-semibold text-foreground">
                {hallName}{' '}
                <span className="font-normal text-muted-foreground">
                  ({list.length} presses — one setup at a time)
                </span>
              </h2>
              <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Press</th>
                      <th className="px-3 py-2 font-medium">Hall</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th
                        className="px-3 py-2 font-medium"
                        title="Progressive lines are coil fed; transfer presses run blanks and have a single setup"
                      >
                        Coil fed
                      </th>
                      <th className="px-3 py-2 font-medium">Tonnage</th>
                      <th className="px-3 py-2 font-medium" title="Days of this press's plan that stay locked">
                        Frozen days
                      </th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {list
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((p) => {
                        const draft = drafts[p._id] ?? draftOf(p)
                        const dirty = !sameDraft(draft, draftOf(p))
                        const busy = savingId === p._id
                        const saveThisRow = () => {
                          if (dirty && !busy) void saveRow(p, draft)
                        }
                        return (
                          <tr
                            key={p._id}
                            className={`border-t border-border ${
                              dirty ? 'bg-amber-50' : ''
                            }`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveThisRow()
                            }}
                          >
                            <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                            <td className="px-3 py-2">
                              <input
                                className={`w-32 ${inputClass}`}
                                value={draft.hall}
                                onChange={(e) => editDraft(p._id, { hall: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                className={`w-40 ${inputClass}`}
                                list="press-categories"
                                placeholder="—"
                                value={draft.category}
                                onChange={(e) => editDraft(p._id, { category: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={draft.feedsCoil}
                                onChange={(e) =>
                                  editDraft(p._id, { feedsCoil: e.target.checked })
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                className={`w-24 ${inputClass}`}
                                placeholder="—"
                                value={draft.tonnage}
                                onChange={(e) => editDraft(p._id, { tonnage: e.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={0}
                                className={`w-20 ${inputClass}`}
                                placeholder="—"
                                value={draft.frozenDays}
                                onChange={(e) =>
                                  editDraft(p._id, { frozenDays: e.target.value })
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-xs whitespace-nowrap">
                              {busy ? (
                                <span className="text-muted-foreground">Saving…</span>
                              ) : dirty ? (
                                <span className="font-medium text-amber-700">
                                  ● Unsaved
                                </span>
                              ) : justSaved[p._id] ? (
                                <span className="font-medium text-emerald-700">
                                  ✓ Saved
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Saved</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <button
                                onClick={saveThisRow}
                                disabled={!dirty || busy}
                                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                className="ml-3 text-xs text-destructive hover:underline"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Delete press ${p.name}? This cannot be undone.`,
                                    )
                                  ) {
                                    void remove({ id: p._id as never })
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {dirtyIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-amber-900">
              {dirtyIds.length === 1
                ? '1 press has unsaved changes'
                : `${dirtyIds.length} presses have unsaved changes`}
            </span>
            <button
              onClick={() => void saveAll()}
              disabled={savingId !== null}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {savingId !== null ? 'Saving…' : 'Save all'}
            </button>
            <button
              onClick={discardAll}
              disabled={savingId !== null}
              className="text-sm text-amber-900 underline hover:no-underline disabled:opacity-50"
            >
              Discard changes
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
