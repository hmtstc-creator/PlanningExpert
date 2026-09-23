import { createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'

export const Route = createFileRoute('/depolar')({
  component: DepolarPage,
})

// These values must match COUNTED_STOCK / RAW_STOCK in planlama.tsx exactly.
const CATEGORIES = [
  {
    value: 'finished_goods',
    label: 'Finished Goods',
    hint: 'Finished product — deducted from the production requirement.',
    color: 'bg-emerald-100 text-emerald-800',
  },
  {
    value: 'production_area',
    label: 'Production Area',
    hint: 'Work in progress — deducted from the production requirement.',
    color: 'bg-teal-100 text-teal-800',
  },
  {
    value: 'raw_material',
    label: 'Raw Material',
    hint: 'Raw coil stock — not finished goods, not deducted from the requirement.',
    color: 'bg-slate-200 text-slate-700',
  },
  {
    value: 'quality',
    label: 'Quality',
    hint: 'Awaiting quality inspection — not counted as available yet.',
    color: 'bg-amber-100 text-amber-800',
  },
  {
    value: 'customer',
    label: 'Customer',
    hint: 'Transferred or sold to the customer — not counted as stock.',
    color: 'bg-slate-200 text-slate-700',
  },
]

const DEFAULT_CATEGORY = 'finished_goods'

function DepolarPage() {
  const { results: locations } = usePaginatedQuery(
    api.storageLocations.list,
    {},
    { initialNumItems: 100 },
  )
  const { results: stockRows } = usePaginatedQuery(
    api.stock.list,
    {},
    { initialNumItems: 500 },
  )
  const {
    run: upsert,
    error: upsertError,
    clearError,
  } = useSafeMutation(api.storageLocations.upsert)
  const { run: removeLocation, error: removeError } = useSafeMutation(
    api.storageLocations.remove,
  )

  const [saving, setSaving] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')

  // Kategori ve not birlikte kaydedilir: `upsert` kaydı tümüyle değiştirir,
  // bu yüzden yalnızca birini göndermek diğerini siler.
  const rows = useDraftRows(
    locations,
    (l) => l.code,
    (l) => ({ category: l.category ?? DEFAULT_CATEGORY, description: l.description ?? '' }),
    (a, b) => a.category === b.category && a.description === b.description,
  )

  const saveLocation = (code: string) => (draft: {
    category: string
    description: string
  }) =>
    upsert({
      code,
      category: draft.category,
      description: draft.description.trim() || undefined,
    })

  const byCode = useMemo(
    () => new Map(locations.map((l) => [l.code, l])),
    [locations],
  )

  // Only locations the user has defined. MB52 no longer seeds this list:
  // stock in an undefined location is explicitly not our concern, and the
  // upload now rejects those rows and names them in its result message.
  const allCodes = useMemo(
    () => locations.map((l) => l.code).sort(),
    [locations],
  )

  async function addManualLocation() {
    const code = newCode.trim()
    if (!code) return
    setSaving(code)
    let ok = false
    try {
      ok = await upsert({ code, category: DEFAULT_CATEGORY })
    } finally {
      setSaving(null)
    }
    // Kutu yalnızca kayıt gerçekten başarılıysa temizlenir.
    if (ok) setNewCode('')
  }

  const stockByLocation = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stockRows) {
      if (!s.storageLocation) continue
      map.set(
        s.storageLocation,
        (map.get(s.storageLocation) ?? 0) + (s.unrestricted ?? 0),
      )
    }
    return map
  }, [stockRows])

  /**
   * Deletes a storage location definition. A location that still appears in
   * MB52 stock does not disappear from the list — only its definition
   * (category/note) is removed and it falls back to the default, because the
   * stock data keeps producing that code.
   */
  async function deleteLocation(code: string) {
    const record = byCode.get(code)
    if (!record) return
    const stillInStock = stockRows.some((s) => s.storageLocation === code)
    const message = stillInStock
      ? `Delete the definition for storage location ${code}? It still appears in MB52 stock, so it will stay in the list but fall back to the default category.`
      : `Remove storage location ${code} from the list entirely?`
    if (!window.confirm(message)) return
    setSaving(code)
    try {
      await removeLocation({ id: record._id })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Storage Locations</h1>
      <p className="mt-2 text-muted-foreground">
        Define the storage locations you care about and choose how each one is
        treated in planning. MB52 rows in any location that is not defined here
        are ignored on upload — stock you have not declared is not your stock.
        This setting answers "which stock do I really have?" and directly
        affects the quantity to be produced.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <div key={c.value} className="rounded-lg border border-border p-3">
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c.color}`}>
              {c.label}
            </span>
            <p className="mt-2 text-xs text-muted-foreground">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-2">
        <input
          className="w-48 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Location code (e.g. 1009)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addManualLocation()
          }}
        />
        <button
          onClick={() => void addManualLocation()}
          disabled={!newCode.trim() || saving === newCode.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Add location
        </button>
      </div>

      <ErrorBanner message={upsertError ?? removeError} onDismiss={clearError} />
      <p className="mt-3 text-sm text-muted-foreground">
        Changing the category or the note marks the location{' '}
        <strong className="text-foreground">Unsaved</strong> — press Save on that
        card, or Save all at the bottom of the page.
      </p>

      {allCodes.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No storage locations defined yet. Add the codes you care about above —
          MB52 rows in any other location are ignored on upload.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {allCodes.map((code) => {
            const current = byCode.get(code)
            const qty = stockByLocation.get(code) ?? 0
            const draft = current
              ? rows.draftFor(current)
              : { category: DEFAULT_CATEGORY, description: '' }
            const dirty = current ? rows.isDirty(current) : false
            const busy = rows.savingKey === code || saving === code
            const saveCard = () => {
              if (dirty && !busy) void rows.commit(code, saveLocation(code))
            }
            return (
              <div
                key={code}
                className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
                  dirty ? 'border-amber-300 bg-amber-50' : 'border-border'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-foreground">{code}</span>
                    <span className="text-xs text-muted-foreground">
                      {qty.toLocaleString('en-GB')} pcs in stock
                    </span>
                    <SaveStatus
                      dirty={dirty}
                      saving={busy}
                      justSaved={!!rows.justSaved[code]}
                    />
                  </div>
                  <input
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm sm:w-72"
                    placeholder="What is this location for? (optional note)"
                    value={draft.description}
                    onChange={(e) =>
                      rows.edit(code, { description: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCard()
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {CATEGORIES.map((c) => {
                    const active = draft.category === c.value
                    return (
                      <button
                        key={c.value}
                        disabled={busy}
                        onClick={() => rows.edit(code, { category: c.value })}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? c.color
                            : 'bg-muted text-muted-foreground hover:bg-muted/70'
                        }`}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                  <button
                    onClick={saveCard}
                    disabled={!dirty || busy}
                    className="ml-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                  >
                    Save
                  </button>
                  {current && (
                    <button
                      disabled={busy}
                      onClick={() => void deleteLocation(code)}
                      title="Delete this storage location definition"
                      className="rounded-md px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Undefined storage locations are treated as "Finished Goods" by default.
      </p>

      <UnsavedBar
        count={rows.dirtyKeys.length}
        saving={rows.savingKey !== null}
        noun="location"
        onSaveAll={() => void rows.commitAll((code, draft) => saveLocation(code)(draft))}
        onDiscard={rows.discardAll}
      />
    </div>
  )
}
