import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { ErrorBanner } from '../ErrorBanner'
import { useQuery } from '../../lib/convexTransport'
import { useSafeMutation } from '../../lib/useSafeMutation'

/** Seçim listeleri (plant'e ait): kalıp ve makine formlarında seçilen değerler. */
const LISTS = [
  { kind: 'operation', label: 'Operations', hint: 'OP10, OP20 … used on mold problem reports' },
  { kind: 'problemType', label: 'Problem types', hint: 'Burr, tear, punch breakage …' },
  { kind: 'maintenanceReason', label: 'Maintenance reasons', hint: 'Suggested on work center maintenance' },
  { kind: 'machineProblemType', label: 'Machine problem types', hint: 'Hydraulic, electrical … used on machine breakdown reports' },
  { kind: 'frequencyStop', label: 'Frequency stops', hint: 'Coil setup, fixture setup … chosen per work center on Work Center Definitions' },
]

export function SelectionLists() {
  const lookups = (useQuery(api.lookups.list) ?? []) as { _id: string; kind: string; value: string }[]
  const { run: addLookup, error: lookupError, clearError } = useSafeMutation(api.lookups.add)
  const { run: removeLookup } = useSafeMutation(api.lookups.remove)
  const [newValue, setNewValue] = useState<Record<string, string>>({})
  const byKind = useMemo(() => {
    const map = new Map<string, typeof lookups>()
    for (const row of lookups) {
      const list = map.get(row.kind) ?? []
      list.push(row)
      map.set(row.kind, list)
    }
    return map
  }, [lookups])
  const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm'
  return (
    <div>
      <ErrorBanner message={lookupError} onDismiss={clearError} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">Selection lists</h2>
        <p className="text-xs text-muted-foreground">Every list is this plant's own — nothing is filled in by the program.</p>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {LISTS.map((list) => (
          <div key={list.kind} className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">{list.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{list.hint}</p>
            <div className="mt-2 flex gap-1">
              <input
                className={`w-full ${inputClass}`}
                placeholder="Add a value"
                value={newValue[list.kind] ?? ''}
                onChange={(e) => setNewValue((v) => ({ ...v, [list.kind]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const value = (newValue[list.kind] ?? '').trim()
                  if (!value) return
                  void addLookup({ kind: list.kind, value }).then((ok) => {
                    if (ok) setNewValue((v) => ({ ...v, [list.kind]: '' }))
                  })
                }}
              />
              <button
                onClick={() => {
                  const value = (newValue[list.kind] ?? '').trim()
                  if (!value) return
                  void addLookup({ kind: list.kind, value }).then((ok) => {
                    if (ok) setNewValue((v) => ({ ...v, [list.kind]: '' }))
                  })
                }}
                disabled={!(newValue[list.kind] ?? '').trim()}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(byKind.get(list.kind) ?? []).map((row) => (
                <span
                  key={row._id}
                  className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
                >
                  {row.value}
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove "${row.value}" from ${list.label}?`)) {
                        void removeLookup({ id: row._id })
                      }
                    }}
                    className="text-destructive"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
              {(byKind.get(list.kind) ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">Empty — add the first value.</span>
              )}
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}
