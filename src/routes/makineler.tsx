import { createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { ErrorBanner } from '../components/ErrorBanner'
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
  const [tonnage, setTonnage] = useState('')
  const [saving, setSaving] = useState(false)

  const byName = useMemo(() => new Map(presses.map((p) => [p.name, p])), [presses])

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

  return (
    <div className="w-full px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Press Definitions</h1>
      <p className="mt-2 text-muted-foreground">
        Define which hall each press sits in — presses in the same hall cannot
        set up at the same time, which is the crane constraint the planner
        relies on. The category is for grouping the plan on screen only;
        which press can run a material still comes from the main and
        alternative machines in master data. Frozen days locks that press's
        plan for the given number of days; leave it empty to use the global
        setting.
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
          Add press
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
                onClick={() => void upsert({ name: p, hall: hall.trim() || 'Hol 1' })}
                className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200"
              >
                + {p}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Clicking adds the press with the hall entered in the "Hall" box above.
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
                      <th className="px-3 py-2 font-medium">Tonnage</th>
                      <th className="px-3 py-2 font-medium" title="Days of this press's plan that stay locked">
                        Frozen days
                      </th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {list
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((p) => (
                        <tr key={p._id} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">{p.name}</td>
                          <td className="px-3 py-2">
                            <input
                              className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm"
                              defaultValue={p.hall}
                              onBlur={(e) =>
                                void upsert({
                                  name: p.name,
                                  hall: e.target.value.trim() || 'Hol 1',
                                  tonnage: p.tonnage,
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm"
                              list="press-categories"
                              placeholder="—"
                              defaultValue={p.category ?? ''}
                              onBlur={(e) =>
                                void upsert({
                                  name: p.name,
                                  hall: p.hall,
                                  category: e.target.value.trim() || undefined,
                                  tonnage: p.tonnage,
                                  frozenDays: p.frozenDays,
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                              defaultValue={p.tonnage ?? ''}
                              onBlur={(e) =>
                                void upsert({
                                  name: p.name,
                                  hall: p.hall,
                                  category: p.category,
                                  frozenDays: p.frozenDays,
                                  tonnage:
                                    e.target.value.trim() === ''
                                      ? undefined
                                      : Number(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
                              placeholder="—"
                              defaultValue={p.frozenDays ?? ''}
                              onBlur={(e) =>
                                void upsert({
                                  name: p.name,
                                  hall: p.hall,
                                  category: p.category,
                                  tonnage: p.tonnage,
                                  frozenDays:
                                    e.target.value.trim() === ''
                                      ? undefined
                                      : Math.max(0, Number(e.target.value)),
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              className="text-xs text-destructive hover:underline"
                              onClick={() => void remove({ id: p._id as never })}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
