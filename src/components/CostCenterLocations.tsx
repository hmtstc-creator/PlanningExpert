import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from '../lib/convexTransport'
import { usePlant } from '../lib/plantContext'
import { useSafeMutation } from '../lib/useSafeMutation'
import { ErrorBanner } from './ErrorBanner'

type Role = 'production' | 'finished' | 'raw'
type Def = Record<Role, string[]>

const ROLES: { key: Role; label: string; hint: string; chip: string }[] = [
  { key: 'production', label: 'Production (WIP)', hint: 'MB51 receipts; also counts as finished stock', chip: 'border-violet-400 bg-violet-100 text-violet-900' },
  { key: 'finished', label: 'Finished goods', hint: 'plan & MRP netting', chip: 'border-emerald-400 bg-emerald-100 text-emerald-900' },
  { key: 'raw', label: 'Raw material', hint: 'coil on hand (MRP)', chip: 'border-sky-400 bg-sky-100 text-sky-900' },
]

const EMPTY: Def = { production: [], finished: [], raw: [] }
const same = (a: Def, b: Def) => ROLES.every(({ key }) => [...a[key]].sort().join() === [...b[key]].sort().join())

/**
 * Storage Locations → depolar cost center başına (organizasyon yapısındaki
 * Plant → Department → Cost center). Bir malzeme bir cost center'ın bitmiş
 * ürünü, başka birinin hammaddesi olabilir; parça, ana makinesinin cost
 * center'ının depolarıyla sayılır (src/lib/stockLocations.ts → stockScope).
 */
export function CostCenterLocations({ locationCodes }: { locationCodes: string[] }) {
  const { ctx } = usePlant()
  const costCenters = (ctx?.active?.costCenters ?? []) as { code: string; name: string; department?: string }[]
  const saved = useQuery(api.storageLocations.listCostCenters)
  const presses = (useQuery(api.presses.list) ?? []) as { name: string; costCenter?: string }[]
  const { run: upsert, error, clearError } = useSafeMutation(api.storageLocations.upsertCostCenter)
  const [drafts, setDrafts] = useState<Record<string, Def>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const savedBy = useMemo(() => {
    const m = new Map<string, Def>()
    for (const d of saved ?? []) m.set(d.costCenter, { production: d.production, finished: d.finished, raw: d.raw })
    return m
  }, [saved])
  const wcCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of presses) if (p.costCenter) m.set(p.costCenter, (m.get(p.costCenter) ?? 0) + 1)
    return m
  }, [presses])

  if (!costCenters.length) {
    return (
      <p className="mt-3 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        This plant has no cost centers yet. Add them in the organisation (Admin → plant → departments); until then
        every material is counted with the location ticks above.
      </p>
    )
  }

  const current = (cc: string) => drafts[cc] ?? savedBy.get(cc) ?? EMPTY
  const toggle = (cc: string, role: Role, code: string) => {
    const d = current(cc)
    const list = d[role].includes(code) ? d[role].filter((c) => c !== code) : [...d[role], code]
    setDrafts((all) => ({ ...all, [cc]: { ...d, [role]: list } }))
  }
  const save = async (cc: string) => {
    setBusy(cc)
    try {
      if (await upsert({ costCenter: cc, ...current(cc) })) {
        setDrafts((all) => {
          const { [cc]: _, ...rest } = all
          return rest
        })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3">
      <ErrorBanner message={error} onDismiss={clearError} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Cost center</th>
              {ROLES.map((r) => (
                <th key={r.key} className="px-3 py-2 font-medium">
                  {r.label}
                  <div className="font-normal">{r.hint}</div>
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {costCenters.map((cc) => {
              const d = current(cc.code)
              const stored = savedBy.get(cc.code) ?? EMPTY
              const dirty = !same(d, stored)
              const defined = savedBy.has(cc.code)
              return (
                <tr key={cc.code} className={`border-t border-border align-top ${dirty ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-foreground">{cc.code}</div>
                    <div className="text-xs text-muted-foreground">
                      {cc.name}
                      {cc.department ? ` · ${cc.department}` : ''} · {wcCount.get(cc.code) ?? 0} WC
                    </div>
                    {!defined && <div className="text-[11px] text-amber-800">uses the location ticks</div>}
                  </td>
                  {ROLES.map((r) => (
                    <td key={r.key} className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {locationCodes.map((code) => {
                          const on = d[r.key].includes(code)
                          return (
                            <button
                              key={code}
                              type="button"
                              aria-pressed={on}
                              aria-label={`${r.label} location ${code} for cost center ${cc.code}`}
                              disabled={busy === cc.code}
                              onClick={() => toggle(cc.code, r.key, code)}
                              className={`rounded border px-2 py-0.5 text-xs tabular-nums ${on ? r.chip : 'border-border text-muted-foreground hover:bg-muted'}`}
                            >
                              {code}
                            </button>
                          )
                        })}
                      </div>
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      onClick={() => void save(cc.code)}
                      disabled={!dirty || busy === cc.code}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                    >
                      Save
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
