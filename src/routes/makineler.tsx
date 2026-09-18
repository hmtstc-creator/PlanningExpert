import { createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { ErrorBanner } from '../components/ErrorBanner'
import { useSafeMutation } from '../lib/useSafeMutation'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/makineler')({
  component: MakinelerPage,
})

type Press = { _id: string; name: string; hall: string; tonnage?: number }

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
      const key = p.hall || '(hol tanımsız)'
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
        hall: hall.trim() || 'Hol 1',
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
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Makine (Pres) Tanımları</h1>
      <p className="mt-2 text-muted-foreground">
        Her presin hangi holde olduğunu tanımla. Aynı holdeki presler aynı anda
        setup yapamaz (vinç kısıtı) — planlama bu tanımı kullanır. Çalışma
        takvimindeki pres listesi de buradan gelir.
      </p>

      <ErrorBanner message={upsertError ?? removeError} onDismiss={clearError} />

      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Pres adı</span>
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
          <span className="block text-xs text-muted-foreground">Hol</span>
          <input
            className="mt-1 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Hol 1"
            value={hall}
            onChange={(e) => setHall(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Tonaj (ops.)</span>
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
          Pres ekle
        </button>
      </div>

      {undefinedPresses.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Referanslarda geçen ama tanımlanmamış presler
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
            Tıklayınca yukarıdaki "Hol" kutusundaki hol ile eklenir.
          </p>
        </div>
      )}

      {presses.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Henüz pres tanımlanmadı.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {halls.map(([hallName, list]) => (
            <div key={hallName}>
              <h2 className="text-sm font-semibold text-foreground">
                {hallName}{' '}
                <span className="font-normal text-muted-foreground">
                  ({list.length} pres — aynı anda tek setup)
                </span>
              </h2>
              <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Pres</th>
                      <th className="px-3 py-2 font-medium">Hol</th>
                      <th className="px-3 py-2 font-medium">Tonaj</th>
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
                              type="number"
                              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                              defaultValue={p.tonnage ?? ''}
                              onBlur={(e) =>
                                void upsert({
                                  name: p.name,
                                  hall: p.hall,
                                  tonnage:
                                    e.target.value.trim() === ''
                                      ? undefined
                                      : Number(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              className="text-xs text-destructive hover:underline"
                              onClick={() => void remove({ id: p._id as never })}
                            >
                              Sil
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
